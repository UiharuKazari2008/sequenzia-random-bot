const systemglobal = require('./config.json');
const facilityName = 'Discord-Replay';

const eris = require('eris');
const fs = require('fs');
const path = require('path');
const amqp = require('amqplib/callback_api');
const crypto = require("crypto");
const storageHandler = require('node-persist');
const os = require('os');
const cron = require('node-cron');
const mysql = require('mysql2');
const colors = require('colors');
const sleep = (waitTimeInMs) => new Promise(resolve => setTimeout(resolve, waitTimeInMs));
const graylog2 = require("graylog2");
const md5 = require('md5');
let logger1 = undefined
let logger2 = undefined
let remoteLogging1 = false
let remoteLogging2 = false
let amqpConn = null;
let pubChannel = null;
let selfstatic = {};
let init = 0;
const accepted_image_types = ['jpeg','jpg','jiff', 'png', 'webp', 'tiff'];
let timers = new Map();

const sqlConnection = mysql.createConnection({
    host: systemglobal.SQLServer,
    user: systemglobal.SQLUsername,
    password: systemglobal.SQLPassword,
    database: systemglobal.SQLDatabase,
    charset: 'utf8mb4'
});
const sqlPromise = sqlConnection.promise();

function simpleSQL (sql_q, callback) {
    sqlConnection.query(sql_q, function (err, rows) {
        //here we return the results of the query
        callback(err, rows);
    });
}
function safeSQL (sql_q, inputs, callback) {
    sqlConnection.query(mysql.format(sql_q, inputs), function (err, rows) {
        callback(err, rows);
    });
}
async function sqlQuery (sql_q, inputs, nolog) {
    if (!nolog)
        console.log(mysql.format(sql_q, inputs))
    try {
        const [rows,fields] = await sqlPromise.query(sql_q, inputs);
        return {
            rows, fields, sql_q, inputs
        }
    } catch (err) {
        console.error(sql_q);
        console.error(inputs);
        console.error(err);
        return {
            rows: [],
            fields: [],
            sql_q,
            inputs,
            error: err
        };
    }
}

if (systemglobal.LogServer && systemglobal.LogServer.length > 0) {
    if (systemglobal.LogServer.length >= 1) {
        remoteLogging1 = true
        logger1 = new graylog2.graylog({
            servers: [systemglobal.LogServer[0]],
            hostname: os.hostname(),
            facility: facilityName,
            bufferSize: 1350
        });
        logger1.on('error', (error) => { console.error('Error while trying to write to graylog host NJA:'.red, error) });

        logger1.debug(`Init : Forwarding logs to Graylog Server 1`, { process: 'Init' });
        console.log(`[${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}][Init] Forwarding logs to Graylog Server 1 - ${facilityName}`.gray);
    }
    if (systemglobal.LogServer.length >= 2) {
        remoteLogging2 = true
        logger2 = new graylog2.graylog({
            servers: [systemglobal.LogServer[1]],
            hostname: os.hostname(),
            facility: facilityName,
            bufferSize: 1350
        });
        logger2.on('error', (error) => { console.error('Error while trying to write to graylog host END:'.red, error) });

        logger1.debug(`Init : Forwarding logs to Graylog Server 2`, { process: 'Init' });
        console.log(`[${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}][Init] Forwarding logs to Graylog Server 2 - ${facilityName}`.gray);
    }
}
async function printLine(proccess, text, level, object, object2) {
    let logObject = {}
    let logClient = "Unknown"
    if (proccess) {
        logClient = proccess
    }
    logObject.process = logClient
    let logString =  `${logClient} : ${text}`
    if (typeof object !== 'undefined' || object) {
        if ( (typeof (object) === 'string' || typeof (object) === 'number' || object instanceof String) ) {
            logString += ` : ${object}`
        } else if (typeof(object) === 'object') {
            logObject = Object.assign({}, logObject, object)
            if (object.hasOwnProperty('message')) {
                logString += ` : ${object.message}`
            } else if (object.hasOwnProperty('sqlMessage')) {
                logString += ` : ${object.sqlMessage}`
            } else if (object.hasOwnProperty('itemFileData')) {
                delete logObject.itemFileData
                logObject.itemFileData = object.itemFileData.length
            }
        }
    }
    if (typeof object2 !== 'undefined' || object2) {
        if (typeof(object2) === 'string' || typeof(object2) === 'number' || object2 instanceof String) {
            logObject.extraMessage = object2.toString()
        } else if (typeof(object2) === 'object') {
            logObject = Object.assign({}, logObject, object2)
            if (object2.hasOwnProperty('itemFileData')) {
                delete logObject.itemFileData
                logObject.itemFileData = object2.itemFileData.length
            }
        }
    }
    if (level === "warn") {
        if (remoteLogging1) { logger1.warning(logString, logObject) } else { console.error(logObject) }
        if (remoteLogging2) { logger2.warning(logString, logObject) }
        console.log(`[${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}][${proccess}] ${text}`.black.bgYellow)
    } else if (level === "error") {
        if (remoteLogging1) { logger1.error(logString, logObject) } else { console.error(logObject) }
        if (remoteLogging2) { logger2.error(logString, logObject) }
        console.log(`[${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}][${proccess}] ${text}`.black.bgRed)
    } else if (level === "critical") {
        if (remoteLogging1) { logger1.critical(logString, logObject) } else { console.error(logObject) }
        if (remoteLogging2) { logger2.critical(logString, logObject) }
        console.log(`[${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}][${proccess}] ${text}`.bgMagenta)
    } else if (level === "alert") {
        if (remoteLogging1) { logger1.alert(logString, logObject) } else { console.log(logObject) }
        if (remoteLogging2) { logger2.alert(logString, logObject) }
        console.log(`[${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}][${proccess}] ${text}`.red)
    } else if (level === "emergency") {
        if (remoteLogging1) { logger1.emergency(logString, logObject) } else { console.error(logObject) }
        if (remoteLogging2) { logger2.emergency(logString, logObject) }
        console.log(`[${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}][${proccess}] ${text}`.bgMagenta)
        sleep(250).then(() => {
            process.exit(4);
        })
    } else if (level === "notice") {
        if (remoteLogging1) { logger1.notice(logString, logObject) } else { console.log(logObject) }
        if (remoteLogging2) { logger2.notice(logString, logObject) }
        console.log(`[${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}][${proccess}] ${text}`.green)
    } else if (level === "alert") {
        if (remoteLogging1) { logger1.alert(logString, logObject) } else { console.log(logObject) }
        if (remoteLogging2) { logger2.alert(logString, logObject) }
        console.log(`[${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}][${proccess}] ${text}`.green)
    } else if (level === "debug") {
        if (remoteLogging1) { logger1.debug(logString, logObject) } else { console.log(logObject) }
        if (remoteLogging2) { logger2.debug(logString, logObject) }
        if (text.includes("New Message: ") || text.includes("Reaction Added: ")) {
            console.log(`[${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}][${proccess}] ${text}`.black.bgCyan)
        } else if (text.includes('Message Deleted: ') || text.includes('Reaction Removed: ')) {
            console.log(`[${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}][${proccess}] ${text}`.black.bgBlue)
        } else if (text.includes('Send Message: ')) {
            console.log(`[${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}][${proccess}] ${text}`.black.bgGreen)
        } else {
            console.log(`[${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}][${proccess}] ${text}`.gray)
        }
    } else if (level === "info") {
        if (remoteLogging1) { logger1.info(logString, logObject) } else { console.log(logObject) }
        if (remoteLogging2) { logger2.info(logString, logObject) }
        if (text.includes("Sent message to ") || text.includes("Connected to Kanmi Exchange as ")) {
            console.log(`[${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}][${proccess}] ${text}`.gray)
        } else if (text.includes('New Media Tweet in')) {
            console.log(`[${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}][${proccess}] ${text}`.black.bgGreen)
        } else if (text.includes('New Text Tweet in')) {
            console.log(`[${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}][${proccess}] ${text}`.black.bgGreen)
        } else {
            console.log(`[${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}][${proccess}] ${text}`.blue)
        }
    } else {
        if (remoteLogging1) { logger1.error(logString, logObject) } else { console.log(logObject) }
        if (remoteLogging2) { logger2.error(logString, logObject) }
        console.log(`[${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}][${proccess}] ${text}`)
    }
}

const MQServer = `amqp://${systemglobal.MQUsername}:${systemglobal.MQPassword}@${systemglobal.MQServer}/?heartbeat=60`
const MQWorkerCmd = `command.discord.${systemglobal.SystemName}`

function runtime() {
    printLine("SQL", "Getting Discord Servers", "debug")
    simpleSQL(`SELECT * FROM discord_servers`,  (err, discordservers) => {
        if (err) {
            printLine("SQL", "Error getting master discord static channels records!", "emergency", err)
            console.error(err)
        } else {
            printLine("Discord", "Settings up Discord bot", "debug")
            let homeGuild = {};
            for (let server of discordservers) {
                if (server.serverid.toString() === systemglobal.DiscordHomeGuild) {
                    homeGuild = server
                }
            }

            const discordClient = new eris.CommandClient(systemglobal.token, {
                compress: true,
                restMode: true,
                intents: [
                    'guildMessages',
                    'guildMessageReactions',
                ]
            }, {
                name: "Kanmi Accessories",
                description: "Multi-Purpose Discord Framework",
                owner: "Yukimi Kazari",
                prefix: "!honey ",
                ignoreSelf: true,
                restMode: true,
            });
            const staticChID = {
                System         : `${homeGuild.chid_system}`,
                AlrmInfo       : `${homeGuild.chid_msg_info}`,
                AlrmWarn       : `${homeGuild.chid_msg_warn}`,
                AlrmErr        : `${homeGuild.chid_msg_err}`,
                AlrmCrit       : `${homeGuild.chid_msg_crit}`,
                AlrmNotif      : `${homeGuild.chid_msg_notif}`,
            }

            function startWorkerCmd() {
                amqpConn.createChannel(function(err, ch) {
                    if (closeOnErr(err)) return;
                    ch.on("error", function(err) {
                        printLine("KanmiMQ", "Channel 0 Error (Command)", "error", err)
                    });
                    ch.on("close", function() {
                        printLine("KanmiMQ", "Channel 0 Closed (Command)", "critical")
                        start();
                    });
                    ch.prefetch(10);
                    ch.assertQueue(MQWorkerCmd, { durable: true }, function(err, _ok) {
                        if (closeOnErr(err)) return;
                        ch.consume(MQWorkerCmd, processMsg, { noAck: true });
                        printLine("KanmiMQ", "Channel 0 Worker Ready (Command)", "debug")
                    });
                    function processMsg(msg) {
                        workCmd(msg, function(ok) {
                            try {
                                if (ok)
                                    ch.ack(msg);
                                else
                                    ch.reject(msg, true);
                            } catch (e) {
                                closeOnErr(e);
                            }
                        });
                    }
                });
            }
            function workCmd(msg, cb) {
                let MessageContents = JSON.parse(Buffer.from(msg.content).toString('utf-8'));
                if (MessageContents.hasOwnProperty('command')) {
                    switch (MessageContents.command) {
                        case 'RESET' :
                            console.log("================================ RESET SYSTEM ================================ ".bgRed);
                            cb(true)
                            process.exit(10);
                            break;
                        case 'ESTOP':
                            cb(true);
                            SendMessage("🛑 EMERGENCY STOP - SEQUENZIA I/O FRAMEWORK", staticChID.AlrmNotif, 'main', "Discord")
                            amqpConn.close();
                            setInterval(function () {
                                console.log("================================ EMERGENCY STOP! ================================ ".bgRed);
                                process.exit(0);
                            }, 1000)
                            break;
                        default:
                            printLine("RemoteCommand", `Unknown Command: ${MessageContents.command}`, "debug");
                            cb(true)
                    }
                }
            }
            function SendMessage(message, channel, guild, proccess, inbody) {
                let body = 'undefined'
                let proc = 'Unknown'
                let errmessage = ''
                if (typeof proccess !== 'undefined' && proccess) {
                    if (proccess !== 'Unknown') {
                        proc = proccess
                    }
                }
                if (typeof inbody !== 'undefined' && inbody) {
                    if (proc === "SQL") {
                        body = "" + inbody.sqlMessage
                    } else if (Object.getPrototypeOf(inbody) === Object.prototype) {
                        if (inbody.message) {
                            body = "" + inbody.message
                        } else {
                            body = "" + JSON.stringify(inbody)
                        }
                    } else {
                        body = "" + inbody
                    }
                }
                let sendto, loglevel
                if (channel === "system") {
                    loglevel = 'info'
                    message = "" + message
                } else if (channel === "systempublic") {
                    loglevel = 'info'
                    message = "" + message
                } else if (channel === "info") {
                    loglevel = 'info'
                    message = "🆗 " + message
                } else if (channel === "warn") {
                    loglevel = 'warning'
                    message = "⚠ " + message
                } else if (channel === "err") {
                    loglevel = 'error'
                    message = "❌ " + message
                } else if (channel === "crit") {
                    loglevel = 'critical'
                    message = "⛔ " + message
                } else if (channel === "message") {
                    loglevel = 'notice'
                    message = "✉️ " + message
                } else {
                    loglevel = 'info'
                }
                if (body !== "undefined" ) {
                    errmessage = ":\n```" + body.substring(0,500) + "```"
                }
                if (channel === "err" || channel === "crit" ) {
                    printLine(proc, message, loglevel, inbody)
                    console.log(inbody)
                } else {
                    printLine(proc, message, loglevel)
                    console.log(inbody)
                }
                if (guild.toString() === 'main') {
                    if (channel === "system") {
                        sendto = staticChID.System
                    } else if (channel === "info") {
                        sendto = staticChID.AlrmInfo
                    } else if (channel === "warn") {
                        sendto = staticChID.AlrmWarn
                    } else if (channel === "err") {
                        sendto = staticChID.AlrmErr
                    } else if (channel === "crit") {
                        sendto = staticChID.AlrmCrit
                    } else if (channel === "message") {
                        sendto = staticChID.AlrmNotif
                    } else {
                        sendto = channel
                    }
                    discordClient.createMessage(sendto, {
                        content: message.substring(0,255) + errmessage
                    })
                        .catch((er) => {
                            printLine("Discord", "Failed to send Message", "critical", er)
                        });
                } else {
                    safeSQL(`SELECT * FROM discord_servers WHERE serverid = ?`, [guild], function (err, serverdata) {
                        if (err) {

                        } else {
                            if (channel === "system") {
                                sendto = serverdata[0].chid_system
                            } else if (channel === "info") {
                                sendto = serverdata[0].chid_msg_info
                            } else if (channel === "warn") {
                                sendto = serverdata[0].chid_msg_warn
                            } else if (channel === "err") {
                                sendto = serverdata[0].chid_msg_err
                            } else if (channel === "crit") {
                                sendto = serverdata[0].chid_msg_crit
                            } else if (channel === "message") {
                                sendto = serverdata[0].chid_msg_notif
                            } else {
                                sendto = channel
                            }

                            discordClient.createMessage(sendto, {
                                content: message.substring(0,255) + errmessage
                            })
                                .catch((er) => {
                                    printLine("Discord", "Failed to send Message", "critical", er)
                                });
                        }
                    })
                }
            }

            function start() {
                amqp.connect(MQServer, function(err, conn) {
                    if (err) {
                        printLine("KanmiMQ", "Initialization Error", "critical", err)
                        return setTimeout(start, 1000);
                    }
                    conn.on("error", function(err) {
                        if (err.message !== "Connection closing") {
                            printLine("KanmiMQ", "Initialization Connection Error", "emergency", err)
                        }
                    });
                    conn.on("close", function() {
                        printLine("KanmiMQ", "Attempting to Reconnect...", "debug")
                        return setTimeout(start, 5000);
                    });
                    printLine("KanmiMQ", `Connected to Kanmi Exchange as ${systemglobal.SystemName}!`, "info")
                    amqpConn = conn;
                    whenConnected();
                });
            }
            function closeOnErr(err) {
                if (!err) return false;
                printLine("KanmiMQ", "Connection Closed due to error", "error", err)
                amqpConn.close();
                return true;
            }
            function whenConnected() {
                startWorkerCmd();
                registerTimers();
                setInterval(registerTimers, 60000)
                discordClient.editStatus( "online",{
                    name: 'alexa',
                    type: 3
                })
            }

            function registerCommands() {
                discordClient.registerCommand("random", function (msg,args) {
                    let searchQuery;
                    if (systemglobal.DefaultRandomQueryPairs) {
                        systemglobal.DefaultRandomQueryPairs.filter(e => e.channel === msq.channel.id).forEach(e => searchQuery = e.query);
                    }
                    if (!searchQuery && systemglobal.DefaultRandomQuery) {
                        searchQuery = systemglobal.DefaultRandomQuery;
                    }
                    sendRandomEmbed({
                        channel: msg.channel.id,
                        search: searchQuery
                    })
                }, {
                    argsRequired: false,
                    caseInsensitive: true,
                    description: "Gives Random Image",
                    guildOnly: true
                })
            }

            function registerTimers() {
                function registerTimer(_in, _hash) {
                    let timer
                    if (_in.search) {
                        timer = cron.schedule(_in.schedule, () => {
                            sendRandomEmbed(_in);
                        });
                    } else {
                        timer = cron.schedule(_in.schedule, () => {
                            sendRandomText(_in);
                        });
                    }

                    timer.scheduleString = _in.schedule;
                    timer.messageText = _in.message;
                    timers.set(_hash, timer);
                }
                simpleSQL(`SELECT * FROM seqran_channels`, (err, channels) => {
                    if (err) {
                        SendMessage(`Error getting channel configuration`, "error", 'main', "SQL", err)
                    } else if (channels.length > 0) {
                        channels.forEach(channel => {
                            if (channel.schedule !== null && cron.validate(channel.schedule)) {
                                const hash = '' + md5(`${channel.channel}-${channel.search}-${channel.message}`)
                                if (timers.has(hash)) {
                                    const _timer = timers.get(hash)
                                    if (channel.enabled === 0) {
                                        printLine("Randomizer", `Removing timer for ${channel.channel}`, "info");
                                        _timer.stop();
                                        timers.delete((hash));
                                    } else if (_timer.scheduleString !== channel.schedule || _timer.messageText !== channel.message) {
                                        printLine("Randomizer", `Updating timer for ${channel.channel} to "${channel.schedule}"`, "info");
                                        _timer.stop();
                                        timers.delete((hash));
                                        registerTimer(channel, hash);
                                    }
                                } else if (channel.enabled === 1) {
                                    printLine("Randomizer", `Registering new timer for ${channel.channel} @ "${channel.schedule}"`, "info");
                                    registerTimer(channel, hash);
                                }
                            }
                        })
                    }
                })
            }
            async function sendRandomText(input) {
                let messageText = '';
                if (input.message) {
                    if (input.message.includes('QUOTE-')) {
                        const tag = input.message.split('QUOTE-').join('')
                        const text = await sqlQuery(`SELECT text FROM seqran_quotes WHERE tag LIKE ? ORDER BY RAND() LIMIT 1`, [`%${tag.toLowerCase()}%`]);
                        if (text.rows.length === 1) {
                            messageText = text.rows[0].text;
                        } else {
                            printLine("Randomizer", `Failed to find a quote tagged as ${tag}, Ignoring`, "error");
                        }
                    }
                }
                discordClient.createMessage(input.channel,{ content: messageText })
                    .then(async (msg) => {
                        printLine("Randomizer", `Sent text to ${input.channel}`, "info");
                        const last = await sqlQuery("SELECT lastmessage FROM seqran_channels WHERE channel = ? AND search IS NULL AND message = ?", [input.channel, input.message]);
                        if (last.rows.length > 0) {
                            if (last.rows[0].lastmessage) {
                                discordClient.deleteMessage(input.channel, last.rows[0].lastmessage)
                                    .catch((err) => SendMessage(`Error deleting last message sent from ${input.channel} - ${err.message}`, "error", 'main', "Randomizer"));
                            }
                            await sqlQuery(`UPDATE seqran_channels SET lastmessage = ? WHERE channel = ? AND search IS NULL AND message = ?`, [msg.id, input.channel, input.message]);
                        }
                    })
                    .catch((err) => SendMessage(`Error sending random item to ${input.channel} - ${err.message}`, "error", 'main', "Randomizer", err))
            }
            async function sendRandomEmbed(input) {
                const itemResults = await sqlQuery(`SELECT kanmi_records.* FROM kanmi_records, kanmi_channels WHERE kanmi_records.channel = kanmi_channels.channelid AND ${(input.search) ? '( ' + input.search + ') AND ' : ''}(attachment_url IS NOT NULL OR cache_url IS NOT NULL) AND attachment_extra IS NULL AND cache_extra IS NULL ORDER BY RAND() LIMIT 1`,);
                if (itemResults.rows.length === 1) {
                    const item = itemResults.rows[0];
                    const metadata = await sqlQuery('SELECT DISTINCT discord_servers.`serverid` as server, discord_servers.`name`, discord_servers.`nice_name` AS server_nice, discord_servers.`avatar`, kanmi_channels.`name` AS channel, kanmi_channels.`nice_name` AS channel_nice, sequenzia_class.`name` AS class, sequenzia_superclass.`uri` AS uri FROM discord_servers, kanmi_channels, sequenzia_class, sequenzia_superclass WHERE discord_servers.`serverid` = kanmi_channels.`serverid` AND kanmi_channels.`channelid` = ? AND sequenzia_class.`class` = kanmi_channels.`classification` AND sequenzia_superclass.`super` = sequenzia_class.`super` LIMIT 1', [item.channel]);
                    if (metadata.rows.length === 1) {
                        const meta = metadata.rows[0];
                        let embed = {
                            title: `${meta.class} / ${(meta.channel_nice)? meta.channel_nice : meta.channel.split('-').join(' ')}`,
                            description: (item.content_full && item.content_full.length >= 2 && item.content_full !== item.attachment_name) ? item.content_full : undefined,
                            url: `https://seq.moe/${meta.uri}?channel=random&search=eid:${item.eid}`,
                            timestamp: item.date,
                            color: (item.colorR && item.colorG && item.colorB) ? (item.colorR << 16) + (item.colorG << 8) + item.colorB : "16095753",
                            footer: {
                                text: (meta.server_nice) ? meta.server_nice : meta.name,
                                icon_url: `https://cdn.discordapp.com/icons/${meta.server}/${meta.avatar}.png`
                            }
                        };
                        let url
                        if (item.attachment_url) {
                            url = item.attachment_url;
                        } else if (item.cache_url) {
                            url = item.cache_url;
                        }
                        if (accepted_image_types.indexOf(url.split('.').pop().toLowerCase())) {
                            embed.image = {
                                "url": url
                            }
                        }

                        let messageText = undefined;
                        if (input.message) {
                            if (input.message.includes('QUOTE-')) {
                                const tag = input.message.split('QUOTE-').join('')
                                const text = await sqlQuery(`SELECT text FROM seqran_quotes WHERE tag LIKE ? ORDER BY RAND() LIMIT 1`, [`%${tag.toLowerCase()}%`]);
                                if (text.rows.length === 1) {
                                    messageText = text.rows[0].text;
                                } else {
                                    printLine("Randomizer", `Failed to find a quote tagged as ${tag}, Ignoring`, "error");
                                }
                            } else {
                                messageText = input.message;
                            }
                        }
                        if (input.updateOnly === 1 && input.lastmessage) {
                            discordClient.editMessage(input.channel,input.lastmessage, { content: messageText, embed: embed })
                                .then(async (msg) => {
                                    printLine("Randomizer", `Sent ${item.attachment_name} to ${msg.channel.id}`, "info");
                                    await discordClient.addMessageReaction(msg.channel.id, msg.id, '🔀')
                                })
                                .catch((err) => SendMessage(`Error sending random item to ${input.channel} - ${err.message}`, "error", 'main', "Randomizer", err))
                        } else {
                            discordClient.createMessage(input.channel,{ content: messageText, embed: embed })
                                .then(async (msg) => {
                                    printLine("Randomizer", `Sent ${item.attachment_name} to ${msg.channel.id}`, "info");
                                    const last = await sqlQuery("SELECT lastmessage FROM seqran_channels WHERE channel = ? AND search = ?", [input.channel, input.search]);
                                    if (last.rows.length > 0) {
                                        if (last.rows[0].lastmessage) {
                                            discordClient.deleteMessage(input.channel, last.rows[0].lastmessage)
                                                .catch((err) => SendMessage(`Error deleting last message sent from ${input.channel} - ${err.message}`, "error", 'main', "Randomizer"))
                                        }
                                        if (input.linked === 1) {
                                            await sqlQuery(`UPDATE seqran_channels SET lastmessage = ? WHERE channel = ?`, [msg.id, input.channel])
                                        } else {
                                            await sqlQuery(`UPDATE seqran_channels SET lastmessage = ? WHERE channel = ? AND search = ?`, [msg.id, input.channel, input.search])
                                        }
                                    }
                                    await discordClient.addMessageReaction(msg.channel.id, msg.id, '🔀')
                                })
                                .catch((err) => SendMessage(`Error sending random item to ${input.channel} - ${err.message}`, "error", 'main', "Randomizer", err))
                        }

                    } else {
                        SendMessage(`No server was found for ${item.server} for ${item.id}, this is not normal!`, "error", 'main', "Randomizer")
                    }
                } else {
                    SendMessage(`No results found using "${input.search}" for ${input.channel}`, "error", 'main', "Randomizer")
                }
            }

            // Discord Event Listeners
            discordClient.on('messageReactionAdd', (msg, emoji, user) => {
                console.log(emoji)
                if (user.id !== discordClient.user.id && emoji.name === '🔀') {
                    safeSQL(`SELECT * FROM seqran_channels WHERE channel = ? AND lastmessage = ? LIMIT 1`, [msg.channel.id, msg.id], (err, channels) => {
                        if (err) {
                            SendMessage(`Error getting channel configuration`, "error", 'main', "SQL", err)
                        } else if (channels.length > 0) {
                            discordClient.removeMessageReactions(msg.channel.id, msg.id)
                            if (channels[0].search) {
                                sendRandomEmbed(channels[0]);
                            } else {
                                sendRandomText(channels[0]);
                            }
                        }
                    })
                }
            })
            discordClient.on("ready", () => {
                printLine("Discord", "Connected successfully to Discord!", "debug")
                discordClient.getSelf()
                    .then(function(data) {
                        selfstatic = data
                        printLine("Discord", `Using Account: ${selfstatic.username} (${selfstatic.id})`, "debug")
                    })
                    .catch((er) => {
                        printLine("Discord", "Error getting self identification, this is a major issue", "emergency", er)
                        console.log(`${er.message}`.bgRed)
                    });
                if (init === 0) {
                    discordClient.editStatus( "dnd",{
                        name: 'Initializing System',
                        type: 0
                    })
                    printLine("Discord", "Registering Commands", "debug")
                    registerCommands();
                    init = 1;
                    start();
                }
            });
            discordClient.on("error", (err) => {
                printLine("Discord", "Shard Error, Rebooting...", "error", err)
                console.error(`${err.message}`.bgRed)
                console.error(err)
                discordClient.connect()
            });

            discordClient.connect().catch((er) => { printLine("Discord", "Failed to connect to Discord", "emergency", er) });
        }
    })
}
runtime();
process.on('uncaughtException', function(err) {
    console.log(err)
    console.log(`[${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}][uncaughtException] ${err.message}`.bgRed);
    if (remoteLogging1) { logger1.critical(`uncaughtException : ${err.message}`, { process: 'Init' }); }
    if (remoteLogging2) { logger2.critical(`uncaughtException : ${err.message}`, { process: 'Init' }); }
});
