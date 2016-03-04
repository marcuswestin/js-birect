var WebSocket = require('websocket').client
var conn = require('./birect-conn')

module.exports = {
	connect: connect
}

var clients = 0
function connect(url) {
	return new Promise((resolve, reject) => {
		var ws = new WebSocket()
		ws.connect(url, 'birect')
		ws.on('connectFailed', (err) => {
			reject(err)
		})
		ws.on('connect', (wsConn) => {
			clients += 1
			resolve(conn.newConn('<client '+clients+'>', wsConn))
		})
	})
}
