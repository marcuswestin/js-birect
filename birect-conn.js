var protobufjs = require('protobufjs')
var create = require('lodash/create')
var bind = require('lodash/bind')
var bindKey = require('lodash/bindKey')
var ByteBuffer = require('bytebuffer')

module.exports = {
	newConn: newConn
}

function newConn(logPrefix, wsConn, jsonReqHandlerMap, protoReqHandlerMap) {
	var handlerMaps = {}
	handlerMaps[wire.DataType.JSON] = (jsonReqHandlerMap || {})
	handlerMaps[wire.DataType.Proto] = (protoReqHandlerMap || {})
	return create(connBase, {
		_lastReqId: 0,
		_responsePromises: {},
		_wsConn: wsConn,
		_logPrefix: logPrefix,
		_handlerMaps: handlerMaps,
	})._setup()
}

var connBase = {
	
	// JSON API
	///////////
	
	sendJSONReq: function(name, params) {
		var data = new Buffer(JSON.stringify(params), 'utf8')
		return this._sendRequestAndWaitForResponse(name, wire.DataType.JSON, data)
	},
	handleJSONReq: function(name, handlerFn) {
		this._registerHandler(wire.DataType.JSON, name, handlerFn)
	},
	
	// Proto API
	////////////
	
	sendProtoReq: function(name, protoMessage) {
		var data = protoMessage.encode().toBuffer()
		return this._sendRequestAndWaitForResponse(name, wire.DataType.Proto, data)
	},
	handleProtoReq: function(name, handlerFn) {
		this._registerHandler(wire.DataType.Proto, name, handlerFn)
	},
	
	// Internal - outgoing wires
	////////////////////////////
	
	_nextReqId: function() {
		this._lastReqId += 1
		return this._lastReqId
	},

	_sendRequestAndWaitForResponse: function(name, wireType, data) {
		var reqId = this._nextReqId()
		var wireReq = new wire.Request({ reqId:reqId, name:name, type:wireType, data:data })
		return new Promise((resolve, reject) => {
			this._responsePromises[reqId] = { resolve:resolve, reject:reject }
			this._log("REQ", wireReq.name, "ReqId:", reqId, "len:", wireReq.data.buffer.length)
			this._sendWrapper(new wire.Wrapper({ request:wireReq }))
		})
	},
	
	_sendResponse: function(reqId, type, res) {
		this._log("SEND RES", reqId)
		var data = this._encode(type, res)
		var wireRes = new wire.Response({ type:type, reqId:reqId, data:data })
		this._sendWrapper(new wire.Wrapper({ response:wireRes }))
	},
	
	_sendResponseError: function(reqId, err) {
		this._log("SEND ERR", reqId, err)
		var publicMessage = (err.publicMessage ? err.publicMessage : 'Oops! Something went wrong. Please try again.')
		var data = new Buffer(publicMessage, 'utf8')
		var wireRes = new wire.Response({ isError:true, type:wire.DataType.Text, reqId:reqId, data:data })
		this.sendWrapper(new wire.Wrapper({ response:wireRes }))
	},

	// Internal - websocket lifecycle
	/////////////////////////////////

	_setup: function() {
		this._wsConn.on('error', (e) => this._onWSError(e))
		this._wsConn.on('close', (e) => this._onWSClose(e))
		this._wsConn.on('message', (wsFrame) => this._onWSFrame(wsFrame))
		return this
	},

	_onWSError: function(err) {
		throw err
	},
	_onWSClose: function() {
		console.log("CLOSED")
	},
	_onWSFrame: function(wsFrame) {
		if (wsFrame.type != 'binary') {
			this._log('Bad websocket data type:', wsFrame.type)
			return
		}
		this._log('FRAME')
		var wireWrapper = wire.Wrapper.decode(wsFrame.binaryData)
		switch (wireWrapper.content) {
			case 'message':
				return this._handleMessage(wireWrapper.message)
			case 'request':
				return this._handleRequest(wireWrapper.request)
			case 'response':
				return this._handleResponse(wireWrapper.response)
			default:
				this._log('Bad wirewrapper:', wireWrapper)
				throw new Error('Bad wirewrapper: ' + wireWrapper)
		}
	},
	
	// Internal - encode/decode
	///////////////////////////
	_encode: function(dataType, data) {
		switch(dataType) {
			case wire.DataType.JSON:
				return new Buffer(JSON.stringify(data), 'utf8')
			case wire.DataType.Proto:
				return data.encode().toBuffer()
			default:
				throw new Error('Bad data type')
		}
	},
	_decode: function(dataType, data) {
		switch(dataType) {
			case wire.DataType.JSON:
				return JSON.parse(data.toBuffer())
			case wire.DataType.Proto:
				return data
			default:
				throw new Error('Bad data type')
		}		
	},

	
	// Internal - incoming wires
	////////////////////////////
	_registerHandler: function(wireType, name, handlerFn) {
		if (this._handlerMaps[wireType][name]) {
			throw new Error('JSON request handler already exists for '+name)
		}
		this._handlerMaps[wireType][name] = handlerFn
	},
	_handleRequest: function(wireReq) {
		this._log('REQ', wireReq.reqId)
		var handler = this._handlerMaps[wireReq.type][wireReq.name]
		var params = this._decode(wireReq.type, wireReq.data)
		handler(params).then(
			(res) => {
				this._sendResponse(wireReq.reqId, wireReq.type, res)
			},
			(err) => {
				this._sendResponseError(wireReq.reqId, err)
			}
		)
	},
	_handleResponse: function(wireRes) {
		this._log('RES', wireRes.reqId)
		var promise = this._responsePromises[wireRes.reqId]
		delete this._responsePromises[wireRes.reqId]
		if (wireRes.isError) {
			promise.reject(new Error(wireRes.data))
			return
		}
		var res = this._decode(wireRes.type, wireRes.data)
		promise.resolve(res)
	},

	// Internal - misc
	//////////////////

	_sendWrapper: function(wrapper) {
		var wireData = wrapper.toBuffer()
		this._log("SND Wrapper len:", wireData.length)
		this._wsConn.sendBytes(wireData)
	},

	_log: function() {
		var args = [this._logPrefix].concat([].slice.call(arguments))
		console.log.apply(this, args)
	}
}

// Internal
///////////

var wire = null
{ // Load wire protobuf
	var fs = require('fs')
	var protobufDefinition = fs.readFileSync(__dirname+'/birect_wire.proto')
	var builder = protobufjs.newBuilder({ convertFieldsToCamelCase:true })
	protobufjs.loadProto(protobufDefinition, builder)
	wire = builder.build('wire')
}
