var WebSocketServer = require('websocket').server
var create = require('lodash/create')
var conn = require('./birect-conn')
var http = require('http')

module.exports = {
	listenAndServe: listendAndServe,
	upgradeRequests: upgradeRequests,
}

function listendAndServe(port, allowConnection) {
	return _newServer()._listenAndServe(port, allowConnection)
}

function upgradeRequests(httpServer, path, allowConnection) {
	return _newServer()._upgradeRequests(httpServer, path, allowConnection)
}

function _newServer() {
	return create(serverBase, {
		_wsServer: null,
		_connectionsById: {},
		_lastId: 0,
		_jsonReqHandlerMap: {},
		_protoReqHandlerMap: {},
	})
}

var serverBase = {
	handleJSONReq: function(name, handlerFn) {
		if (this._jsonReqHandlerMap[name]) {
			throw new Error('JSON request handler already exists for '+name)
		}
		this._jsonReqHandlerMap[name] = handlerFn
	},
	handleProtoReq: function(name, handlerFn) {
		if (this._protoReqHandlerMap[name]) {
			throw new Error('Proto request handler already exists for '+name)
		}
		this._protoReqHandlerMap[name] = handlerFn
	},
	
	// Internal
	///////////
	
	_upgradeRequests: function(httpServer, path, allowConnection) {
		return this._setup({
			path: path,
			allowConnection: allowConnection,
			httpServer: httpServer,
			port: null
		})
	},
	_listenAndServe: function(port, allowConnection) {
		var httpServer = http.createServer()
		httpServer.listen(port)
		return this._setup({
			autoAcceptConnections: false,
			httpServer: httpServer,
			allowConnection: allowConnection,
		})
	},
	_setup: function(opts) {
		var wsServer = new WebSocketServer({
			autoAcceptConnections: false,
			httpServer: opts.httpServer,
		})
		this._wsServer = wsServer
		wsServer.on('request', (req) => {
			this._checkUpgradeRequest(opts, req)
		})
		wsServer.on('connect', (wsConn) => {
			this._onWSConnection(wsConn)
		})
		return this
	},
	_checkUpgradeRequest: function(opts, req) {
		if (opts.allowConnection && !opts.allowConnection(req)) {
			return req.reject(400, 'Bad request')
		} else if (opts.path && req.resource != opts.path) {
			return req.reject(404, 'Not found')
		} else {
			req.accept('birect', req.origin)
		}
	},
	_onWSConnection: function(wsConn) {
		wsConn.birectConn = conn.newConn('<server>', wsConn, this._jsonReqHandlerMap, this._protoReqHandlerMap)
		wsConn.on('close', function() {
			delete wsConn.birectConn
		})
	},
}
