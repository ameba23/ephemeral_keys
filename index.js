const mkdirp = require('mkdirp')
const { join } = require('path')
const level = require('level')
const { assert, isString, isObject, isFunction } = require('./util')

const curve = 'curve25519'
const defaultContextMessage = 'SSB Ephemeral key'
const cipherTextSuffix = '.box'

const { keyPair, decryptMessage, encryptMessage } = require('./crypto')

module.exports = {
  name: 'ephemeral',
  version: require('./package.json').version,
  manifest: {
    generateAndStore: 'async',
    boxMessage: 'async',
    unBoxMessage: 'async',
    deleteKeypair: 'async'
  },
  init: function (server, config) {
    mkdirp.sync(join(config.path, 'ephemeral-keys'))
    const db = level(join(config.path, 'ephemeral-keys'))

    function generateAndStore (dbKey, callback) {
      const ephKeypairBuffer = keyPair()
      var ephKeypair = {}

      for (var k in ephKeypairBuffer) ephKeypair[k] = packKey(ephKeypairBuffer[k])

      // TODO: level allows objects as keys but i cant get it to work, hence this
      if (isObject(dbKey)) { dbKey = JSON.stringify(dbKey) }

      db.put(dbKey, ephKeypair, {valueEncoding: 'json'}, (err) => {
        if (err) return callback(err)
        callback(null, ephKeypair.publicKey)
      })
    }

    function boxMessage (message, pubKeyBase64, contextMessageString, callback) {
      assert(isString(message), 'Message must be a string')
      const messageBuffer = Buffer.from(message, 'utf-8')
      assert(isString(pubKeyBase64), 'Public key must be a string')
      const pubKey = unpackKey(pubKeyBase64)
      if (isFunction(contextMessageString) && !callback) {
        callback = contextMessageString
        contextMessageString = defaultContextMessage
      }

      contextMessageString = contextMessageString || defaultContextMessage
      if (isObject(contextMessageString)) contextMessageString = JSON.stringify(contextMessageString)
      assert(isString(contextMessageString), 'Context message must be a string')
      const contextMessage = Buffer.from(contextMessageString, 'utf-8')

      callback(null, encryptMessage(pubKey, messageBuffer, contextMessage) + cipherTextSuffix)
    }

    function unBoxMessage (dbKey, cipherTextBase64, contextMessageString, callback) {
      if (isFunction(contextMessageString) && !callback) {
        callback = contextMessageString
        contextMessageString = defaultContextMessage
      }

      contextMessageString = contextMessageString || defaultContextMessage
      if (isObject(contextMessageString)) contextMessageString = JSON.stringify(contextMessageString)
      assert(isString(contextMessageString), 'Context message must be a string')
      const contextMessage = Buffer.from(contextMessageString, 'utf-8')

      assert(isString(cipherTextBase64), 'Ciphertext must be a string')

      if (cipherTextBase64.slice(-1 * cipherTextSuffix.length) !== cipherTextSuffix) {
        return callback(new Error('Ciphertext must end in ' + cipherTextSuffix))
      }

      try {
        var cipherText = Buffer.from(cipherTextBase64.slice(0, -1 * cipherTextSuffix.length), 'base64')
        var nonce = cipherText.slice(0, NONCEBYTES)
        var pubKey = cipherText.slice(NONCEBYTES, NONCEBYTES + KEYBYTES)
        var box = cipherText.slice(NONCEBYTES + KEYBYTES, cipherText.length)
        var unboxed = Buffer.alloc(box.length - sodium.crypto_secretbox_MACBYTES)
      } catch (err) {
        return callback(new Error('Invalid ciphertext'))
      }
      // TODO: level allows objects as keys but i cant get it to work, hence this
      if (isObject(dbKey)) { dbKey = JSON.stringify(dbKey) }

      db.get(dbKey, {valueEncoding: 'json'}, (err, ephKeypairBase64) => {
        if (err) return callback(err)

        var ephKeypair = {}
        try {
          for (var k in ephKeypairBase64) ephKeypair[k] = unpackKey(ephKeypairBase64[k])
        } catch (err) {
          return callback(err)
        }

        const plainText = decryptMessage(ephKeypair, pubKey, box, unboxed, contextMessage, nonce)
        if (!plainText) {
          callback(new Error('Decryption failed'))
        } else {
          callback(null, plainText)
        }
      })
    }

    function deleteKeyPair (dbKey, callback) {
      // TODO: level allows objects as keys but i cant get it to work, hence this
      if (isObject(dbKey)) { dbKey = JSON.stringify(dbKey) }

      db.del(dbKey, (err) => {
        if (err) return callback(err)
        callback()
      })
    }

    return {
      generateAndStore,
      boxMessage,
      unBoxMessage,
      deleteKeyPair
    }
  }
}

const packKey = k => k.toString('base64') + '.' + curve

function unpackKey (k) {
  assert((k.split('.').slice(-1)[0] === curve), 'Encountered key with unsupported curve')
  return Buffer.from(k.slice(0, -curve.length - 1), 'base64')
}
