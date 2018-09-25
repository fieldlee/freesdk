// log4js
let log4js = require('log4js');
let logger = log4js.getLogger('HyperledgerWebApp');
// express
let express = require('express');
let session = require('express-session');
let cookieParser = require('cookie-parser');
let bodyParser = require('body-parser');
let http = require('http');
let util = require('util');

let expressJWT = require('express-jwt');
let jwt = require('jsonwebtoken');
let bearerToken = require('express-bearer-token');
let cors = require('cors');
let path = require('path');
let hfc = require('fabric-client');
let app = express();

hfc.addConfigFile(path.join(__dirname, 'config.json'));

var helper = require('./app/helper.js');
var channels = require('./app/create-channel.js');
var join = require('./app/join-channel.js');
var install = require('./app/install-chaincode.js');
var instantiate = require('./app/instantiate-chaincode.js');
var upgrade = require('./app/update-chaincode.js');
var invoke = require('./app/invoke-transaction.js');
var query = require('./app/query.js');

var chanList = hfc.getConfigSetting("channels");
var allChanTx = {};
var getChatBlockHeight = 0;
var allChatBlock = {};
var allChatTx = {};
var defaultChannelId = "channel";
logger.debug('chanList  : ' + chanList);
if (chanList && chanList.length > 0) {
	defaultChannelId = chanList[0]["channelId"];
	// chanList
	for (const index in chanList) {
		logger.debug('chan  : ' + chanList[index]);
		logger.debug('chan.channelId  : ' + chanList[index].channelId);
		allChanTx[chanList[index].channelId] = {}
		allChanTx[chanList[index].channelId]["blockHeight"] = 0;
		allChanTx[chanList[index].channelId]["txNum"] = 0;
		allChanTx[chanList[index].channelId]["hadReadHeight"] = 0;
	}
}

let host = process.env.HOST || hfc.getConfigSetting('host');
let port = process.env.PORT || hfc.getConfigSetting('port');

app.options('*', cors());
app.use(cors());
//support parsing of application/json type post data
app.use(bodyParser.json());
//support parsing of application/x-www-form-urlencoded post data
app.use(bodyParser.urlencoded({
	extended: false
}));

///////////////////////////////////////////////////////////////////////////////
//////////////////////////////// START SERVER /////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
var server = http.createServer(app).listen(port, function () { });

logger.info('****************** SERVER STARTED ************************');
logger.info('**************  http://' + host + ':' + port + '  ******************');
server.timeout = 240000;
function getErrorMessage(field) {
	var response = {
		success: false,
		info: field + ' field is missing or Invalid in the request'
	};
	return response;
}

///////////////////////////////////////////////////////////////////////////////
///////////////////////// REST ENDPOINTS START HERE ///////////////////////////
///////////////////////////////////////////////////////////////////////////////
// Register and enroll user
app.post('/login', function (req, res) {
	var username = req.body.username;
	var password = req.body.password;
	var orgName = req.body.orgName;
	logger.debug('End point : /login');
	logger.debug('User name : ' + username);
	logger.debug('Org name  : ' + orgName);
	if (!username) {
		res.json(getErrorMessage('\'username\''));
		return;
	}
	if (!orgName) {
		res.json(getErrorMessage('\'orgName\''));
		return;
	}
	var token = jwt.sign({
		exp: Math.floor(Date.now() / 1000) + parseInt(hfc.getConfigSetting('jwt_expiretime')),
		username: username,
		orgName: orgName
	}, app.get('secret'));

	helper.getRegisteredUsers(username, orgName, true, password).then(function (response) {
		if (response && typeof response !== 'string') {
			response.token = token;
			res.send(response);
		} else {
			res.json({
				success: false,
				info: response
			});
		}
	});
});
app.post('/register',function (req, res) {
	var username = req.body.username;
	var password = req.body.password;
	var orgName = req.body.orgName;
	logger.debug('End point : /register');
	logger.debug('User name : ' + username);
	logger.debug('Org name  : ' + orgName);
	if (!username) {
		res.json(getErrorMessage('\'username\''));
		return;
	}
	if (!orgName) {
		res.json(getErrorMessage('\'orgName\''));
		return;
	}
	helper.registerUser(username, orgName, true).then(function (response) {
		if (response && typeof response !== 'string') {
			res.send(response);
		} else {
			res.json({
				success: false,
				info: response
			});
		}
	});
});

// Invoke transaction on chaincode on target peers
app.post('/channels/:channel/chaincodes/:chaincodeName', function (req, res) {
	logger.debug('==================== INVOKE ON CHAINCODE ==================');
	var peers = req.body.peers;
	var chaincodeName = req.params.chaincodeName;
	var channelName = req.params.channel;
	var username = req.body.username;
	var orgname = req.body.orgName;
	var fcn = req.body.fcn;
	var args = req.body.args;
	logger.debug('channelName  : ' + channelName);
	logger.debug('chaincodeName : ' + chaincodeName);
	logger.debug('fcn  : ' + fcn);
	logger.debug('args  : ' + args);
	if (!chaincodeName) {
		res.json(getErrorMessage('\'chaincodeName\''));
		return;
	}
	if (!channelName) {
		res.json(getErrorMessage('\'channelName\''));
		return;
	}
	if (!fcn) {
		res.json(getErrorMessage('\'fcn\''));
		return;
	}
	if (!args) {
		res.json(getErrorMessage('\'args\''));
		return;
	}
	helper.loginRegisteredUser(username, orgname).then(function(result) {
		if (result == true) {
			invoke.invokeChaincode(peers, channelName, chaincodeName, fcn, args, req.username, req.orgname)
			.then(function (message) {
				if (message && typeof message !== 'string') {
					res.json(message);
				} else {
					res.json({
						success: true,
						info: message
					});
				}
			});
		}else{
			res.json({
				success: false,
				info: "账号错误，请确认用户名和组织ID正确"
			});
		}
	});
	
});
// post Query on chaincode on target peers
app.post('/query/channels/:channel/chaincodes/:chaincodeName', function (req, res) {
	logger.debug('==================== QUERY BY CHAINCODE ==================');
	var channelName = req.params.channel;
	var chaincodeName = req.params.chaincodeName;
	let args = req.body.args;
	let fcn = req.body.fcn;
	let peer = req.body.peer;

	logger.debug('channelName : ' + channelName);
	logger.debug('chaincodeName : ' + chaincodeName);
	logger.debug('fcn : ' + fcn);
	logger.debug('args : ' + args);

	if (!chaincodeName) {
		res.json(getErrorMessage('\'chaincodeName\''));
		return;
	}
	if (!channelName) {
		res.json(getErrorMessage('\'channelName\''));
		return;
	}
	if (!fcn) {
		res.json(getErrorMessage('\'fcn\''));
		return;
	}
	if (!args) {
		res.json(getErrorMessage('\'args\''));
		return;
	}

	query.queryChaincode(peer, channelName, chaincodeName, args, fcn, req.username, req.orgname)
		.then(function (message) {
			if (message && typeof message !== 'string') {
				res.json({
					success: true,
					info: message
				});
			} else {
				// logger.info(message);
				let jmsg = JSON.parse(message);
				if (jmsg && typeof jmsg !== 'string') {
					res.json({
						success: true,
						info: message
					});
				}
				else {
					res.json({
						success: false,
						info: jmsg
					});
				}
			}
		});
});
//  Query Get Block by BlockNumber
app.get('/channels/blocks/:blockId', function (req, res) {
	logger.debug('==================== GET BLOCK BY NUMBER ==================');
	let blockId = req.params.blockId;
	let peer = req.query.peer;

	logger.debug('BlockID : ' + blockId);
	logger.debug('Peer : ' + peer);
	if (!blockId) {
		res.json(getErrorMessage('\'blockId\''));
		return;
	}

	query.getBlockByNumber(peer, blockId, req.username, req.orgname)
		.then(function (message) {
			if (message && typeof message !== 'string') {
				res.json(message);
			} else {
				logger.info(message);
				let jmsg = JSON.parse(message);
				if (jmsg && typeof jmsg !== 'string') {
					res.json(jmsg);
				}
				else {
					res.json({
						success: false,
						info: jmsg
					});
				}
			}
		});
});
// Query Get Transaction by Transaction ID
app.get('/channels/transactions/:trxnId', function (req, res) {
	logger.debug(
		'================ GET TRANSACTION BY TRANSACTION_ID ======================'
	);
	logger.debug('channelName : ' + hfc.getConfigSetting('channelName'));
	let trxnId = req.params.trxnId;
	let peer = req.query.peer;
	if (!trxnId) {
		res.json(getErrorMessage('\'trxnId\''));
		return;
	}
	query.getTransactionByID(peer, trxnId, req.username, req.orgname)
		.then(function (message) {
			if (message && typeof message !== 'string') {
				res.json(message);
			} else {
				logger.info(message);
				let jmsg = JSON.parse(message);
				if (jmsg && typeof jmsg !== 'string') {
					res.json(jmsg);
				}
				else {
					res.json({
						success: false,
						info: jmsg
					});
				}
			}
		});
});
// Query Get Block by Hash
app.get('/channels/blocks', function (req, res) {
	logger.debug('================ GET BLOCK BY HASH ======================');
	logger.debug('channelName : ' + hfc.getConfigSetting('channelName'));
	let hash = req.query.hash;
	let peer = req.query.peer;
	if (!hash) {
		res.json(getErrorMessage('\'hash\''));
		return;
	}

	query.getBlockByHash(peer, hash, req.username, req.orgname).then(
		function (message) {
			if (message && typeof message !== 'string') {
				res.json(message);
			} else {
				logger.info(message);
				let jmsg = JSON.parse(message);
				if (jmsg && typeof jmsg !== 'string') {
					res.json(jmsg);
				}
				else {
					res.json({
						success: false,
						info: jmsg
					});
				}
			}
		});
});
//Query for Channel Information
app.get('/channels/chaininfo', function (req, res) {
	logger.debug(
		'================ GET CHANNEL INFORMATION ======================');

	let peer = req.query.peer;

	query.getChainInfo(peer, req.username, req.orgname).then(
		function (message) {
			if (message && typeof message !== 'string') {
				res.json(message);
			} else {
				logger.info(message);
				let jmsg = JSON.parse(message);
				if (jmsg && typeof jmsg !== 'string') {
					res.json(jmsg);
				}
				else {
					res.json({
						success: false,
						info: jmsg
					});
				}
			}
		});
});
// Query to fetch all Installed/instantiated chaincodes
app.get('/chaincodes', function (req, res) {
	var peer = req.query.peer;
	var installType = req.query.type;
	//TODO: add Constnats
	if (installType === 'installed') {
		logger.debug(
			'================ GET INSTALLED CHAINCODES ======================');
	} else {
		logger.debug(
			'================ GET INSTANTIATED CHAINCODES ======================');
	}

	query.getInstalledChaincodes(peer, installType, req.username, req.orgname)
		.then(function (message) {
			if (message && typeof message !== 'string') {
				res.json(message);
			} else {
				logger.info(message);
				let jmsg = JSON.parse(message);
				if (jmsg && typeof jmsg !== 'string') {
					res.json(jmsg);
				}
				else {
					res.json({
						success: false,
						info: jmsg
					});
				}
			}
		});
});
// Query to fetch channels
app.get('/channels', function (req, res) {
	logger.debug('================ GET CHANNELS ======================');
	logger.debug('peer: ' + req.query.peer);
	var peer = req.query.peer;
	if (!peer) {
		res.json(getErrorMessage('\'peer\''));
		return;
	}
	query.getChannels(peer, req.username, req.orgname)
		.then(function (message) {
			if (message && typeof message !== 'string') {
				res.json(message);
			} else {
				logger.info(message);
				let jmsg = JSON.parse(message);
				if (jmsg && typeof jmsg !== 'string') {
					res.json(jmsg);
				}
				else {
					res.json({
						success: false,
						info: jmsg
					});
				}
			}
		});
});
// 获得所有的交易和块
app.get('/blocktxnum', async function (req, res) {
	logger.debug('================ GET All CHANNEL BLOCK Number ======================');
	// logger.debug(allChanTx);
	var allBlockNum = 0;
	var allTxNum = 0;
	for (let index = 0; index < chanList.length; index++) {
		const chan = chanList[index];
		if (chan.includes && chan.includes[0]) {
			var client = helper.getClientForOrg(chan.includes[0]);
			var target = helper.buildTarget("peer0", chan.includes[0]);
			var channel = client.getChannel(chan.channelId);
			if (!channel) {
				continue;
			}
			let blocknum = await helper.getChannelInfo(channel, target, chan.includes[0]);
			// 设置chan 的blockheight
			if (blocknum != null) {
				allChanTx[chan.channelId]["blockHeight"] = blocknum;
				allBlockNum = allBlockNum + blocknum;
				allTxNum = allTxNum + allChanTx[chan.channelId]["txNum"]; //添加已有的transcations number
				for (let index = allChanTx[chan.channelId]["hadReadHeight"]; index < blocknum; index++) {
					let txNum = await helper.getBlockTx(channel, index, chan.includes[0]);
					if (txNum != null) {
						allTxNum = allTxNum + txNum;
						allChanTx[chan.channelId]["txNum"] = allChanTx[chan.channelId]["txNum"] + txNum;
					}
				}
				allChanTx[chan.channelId]["hadReadHeight"] = blocknum;
			} else {
				allChanTx[chan.channelId]["blockHeight"] = 0;
				allChanTx[chan.channelId]["txNum"] = 0;
				allChanTx[chan.channelId]["hadReadHeight"] = 0;
			}
		}
	}
	// 读取
	res.json({
		"blockHeight": allBlockNum,
		"txNum": allTxNum
	});
});
// 获取block和交易的图表数据
app.get('/blockchat', async function (req, res) {
	logger.debug('================ GET All CHANNEL Chat ======================');
	// logger.debug(allChatBlock);
	// logger.debug(allChatTx);
	for (let index = 0; index < chanList.length; index++) {
		const chan = chanList[index];
		if (chan.includes && chan.includes[0]) {
			var client = helper.getClientForOrg(chan.includes[0]);
			var target = helper.buildTarget("peer0", chan.includes[0]);
			var channel = client.getChannel(chan.channelId);
			if (!channel) {
				continue;
			}
			let blocknum = await helper.getChannelInfo(channel, target, chan.includes[0]);
			// 设置chan 的blockheight
			if (blocknum != null) {
				for (let index = getChatBlockHeight; index < blocknum; index++) {
					let blocktxObj = await helper.getBlockDateNumber(channel, index, chan.includes[0]);
					// logger.debug('blocktxObj: ' + blocktxObj);
					if (typeof blocktxObj == "object") {
						// logger.debug('Object.keys(blocktxObj): ' + Object.keys(blocktxObj));
						for (let index = 0; index < Object.keys(blocktxObj).length; index++) {
							const elekey = Object.keys(blocktxObj)[index];
							const eleobj = blocktxObj[elekey];
					
							// 设置内存的block值
							if (Object.keys(allChatBlock).indexOf(elekey) >= 0) {
								allChatBlock[elekey] = allChatBlock[elekey] + 1;
							} else {
								allChatBlock[elekey] = 0;
							}
							// 设置内存的tx值
							if (Object.keys(allChatTx).indexOf(elekey) >= 0) {
								allChatTx[elekey] = allChatTx[elekey] + eleobj["tx"];
							} else {
								allChatTx[elekey] = 0;
							}
			
						}
					}
				}
				getChatBlockHeight = blocknum; //设置chat block height
			}
		}
	}
	// 读取
	res.json({
		"block": allChatBlock,
		"tx": allChatTx
	});
});