var tinytest = require('tinytest')
var test = tinytest.test
var assert = tinytest.assert
var await = tinytest.await
var conn = require('./birect-conn')
var server = require('./birect-server')
var client = require('./birect-client')

var port = 8085

test('Start server 1', function() {
	var http = require('http')
	var httpServer = http.createServer((req, res) => { res.end('Hi') })
	await(new Promise((resolve, reject) => {
		httpServer.listen(port, () => {
			console.log("Server listening on", port)
			resolve()
		})
	}))
	
	var birectServer = server.upgradeRequests(httpServer, '/birect/upgrade')
	birectServer.handleJSONReq('Echo', function(req) {
		return new Promise((resolve) => {
			resolve({ Text:req.Text })
		})
	})
})

test('Echo client', function() {
	var c = await(client.connect("ws://localhost:"+port+"/birect/upgrade"))
	var res = await(c.sendJSONReq("Echo", { Text:"Foo" }))
	assert(res.Text == 'Foo')
})

test('Start server 2', function() {
	var birectServer = server.listenAndServe(port + 1)
	birectServer.handleJSONReq('Echo', function(req) {
		return new Promise((resolve) => {
			resolve({ Text:req.Text })
		})
	})
})

test('Echo client 2', function() {
	var c = await(client.connect("ws://localhost:"+(port + 1)+"/birect/upgrade"))
	var res = await(c.sendJSONReq("Echo", { Text:"Foo" }))
	assert(res.Text == 'Foo')
})
