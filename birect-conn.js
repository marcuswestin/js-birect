var protobufjs = require('protobufjs')
var create = require('lodash/create')
var bind = require('lodash/bind')
var bindKey = require('lodash/bindKey')
var ByteBuffer = require('bytebuffer')

module.exports = {
	newConn: newConn
}

function newConn(logPrefix, wsConn, jsonReqHandlerMap) {
	return create(connBase, {
		_lastReqId: 0,
		_responsePromises: {},
		_wsConn: wsConn,
		_logPrefix: logPrefix,
		// JSON API
		_jsonReqHandlerMap: jsonReqHandlerMap || {},
		// Proto API
		
	})._setup()
}

var connBase = {
	
	// JSON API
	///////////
	
	sendJSONReq: function(name, params) {
		var data = new Buffer(JSON.stringify(params), 'utf8')
		var reqId = this._nextReqId()
		var wireReq = new wire.Request({ type:wire.DataType.JSON, name:name, reqId:reqId, data:data})
		return this._sendRequestAndWaitForResponse(reqId, wireReq)
	},
	handleJSONReq: function(name, handlerFn) {
		if (this._jsonReqHandlerMap[name]) {
			throw new Error('JSON request handler already exists for '+name)
		}
		this._jsonReqHandlerMap[name] = handlerFn
	},
	_handleIncomingJSONReq: function(wireReq) {
		var handler = this._jsonReqHandlerMap[wireReq.name]
		var params = JSON.parse(wireReq.data.toBuffer())
		handler(params).then(
			(res) => {
				var data = new Buffer(JSON.stringify(res), 'utf8')
				this._sendResponse(wire.DataType.JSON, wireReq.reqId, data)
			},
			(err) => {
				this._sendResponseError(wireReq.reqId, err)
			}
		).catch((err) => {
			this._log("ERROR SENDING RESPONSE", err)
		})
	},
	
	// Proto API
	////////////
	
	// TODO

	// Internal - outgoing wires
	////////////////////////////
	
	_nextReqId: function() {
		this._lastReqId += 1
		return this._lastReqId
	},

	_sendRequestAndWaitForResponse: function(reqId, wireReq) {
		return new Promise((resolve, reject) => {
			this._responsePromises[reqId] = { resolve:resolve, reject:reject }
			this._log("REQ", wireReq.name, "ReqId:", reqId, "len:", wireReq.data.buffer.length)
			this._sendWrapper(new wire.Wrapper({ request:wireReq }))
		})
	},
	
	_sendResponse: function(type, reqId, data) {
		this._log("SEND RES", reqId)
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
				throw new Error('Bad wirewrapper:', wireWrapper)
		}
	},
	
	// Internal - incoming wires
	////////////////////////////
	_handleResponse: function(wireRes) {
		var promise = this._responsePromises[wireRes.reqId]
		delete this._responsePromises[wireRes.reqId]
		this._log("RES reqId:", wireRes.reqId, "dataType:", wireRes.type, "len(data):", wireRes.data.buffer.length)
		if (wireRes.isError) {
			promise.reject(new Error(wireRes.data))
			return
		}
		switch (wireRes.type) {
			case wire.DataType.JSON:
				return promise.resolve(JSON.parse(wireRes.data.toBuffer()))
			default:
				throw new Error("Bad response wire type: " + wireRes.type)
		}
	},
	
	_handleRequest: function(wireReq) {
		this._log('Handle req:', wireReq.name)
		switch (wireReq.type) {
			case wire.DataType.JSON:
				return this._handleIncomingJSONReq(wireReq)
			default:
				throw new Error('Bad request data type: ' + wireReq.type)
		}
	},

	// Internal - misc
	//////////////////

	_sendWrapper: function(wrapper) {
		this._log("SND Wrapper...")
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
