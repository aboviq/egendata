const axios = require('axios')
const { constant } = require('case')
const schemas = require('./schemas')

const fix = (consent) => ({
  ...consent,
  scope: Array.isArray(consent.scope)
    ? consent.scope.map(scope => ({
      ...scope,
      permissions: Array.isArray(scope.permissions)
        ? scope.permissions.map(p => constant(p))
        : scope.permissions,
      lawfulBasis: scope.lawfulBasis
        ? constant(scope.lawfulBasis)
        : scope.lawfulBasis
    }))
    : consent.scope
})

async function request (client, consentRequestDescription) {
  await client.connect()
  consentRequestDescription = fix(consentRequestDescription)
  await schemas.consentRequest.validate(consentRequestDescription)

  const encKey = await client.keyProvider.generateTempKey({ use: 'enc' })
  const data = {
    ...consentRequestDescription,
    clientId: client.config.clientId,
    kid: encKey.kid
  }
  const signature = await client.sign(data, 'client_key')
  const url = `${client.config.operator}/api/consents/requests`
  const response = await axios.post(url, { data, signature })
  return response.data.data
}

async function onApprove (client, consent) {
  await saveKeys(consent.consentId, consent.keys, client)
  await Promise.all(consent.scope.map(s => saveAccessKeyIds(consent.consentId, s, client)))
}

async function saveKeys (consentId, keysObj, { keyProvider, config: { jwksUrl } }) {
  const keys = Object
    .entries(keysObj)
    .map(([kid, str]) => ({
      kid,
      use: 'enc',
      publicKey: Buffer.from(str, 'base64').toString('utf8')
    }))

  const rxJwks = new RegExp(`^${jwksUrl}/`)
  const consentKeyId = keys.find(({ kid }) => rxJwks.test(kid)).kid
  const consentKey = await keyProvider.getKey(consentKeyId)
  const externalKeys = keys.filter(({ kid }) => kid !== consentKeyId)

  return Promise.all([
    keyProvider.saveKey(consentKey),
    keyProvider.saveConsentKeyId(consentId, consentKeyId),
    ...externalKeys.map(key => keyProvider.saveKey(key))
  ])
}

async function saveAccessKeyIds (consentId, scope, { keyProvider }) {
  const { domain, area, accessKeyIds } = scope
  return keyProvider.saveAccessKeyIds(consentId, domain, area, accessKeyIds)
}

module.exports = client => ({
  request: (consentRequestDescription) => request(client, consentRequestDescription),
  onApprove: (consent) => onApprove(client, consent)
})
