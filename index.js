const systemglobal = require('./config.json');
const facilityName = 'Discord-Replay';

const eris = require('eris');
const fs = require('fs');
const path = require('path');
const crypto = require("crypto");
const os = require('os');
const cron = require('node-cron');
const mysql = require('mysql2');
const colors = require('colors');
const sleep = (waitTimeInMs) => new Promise(resolve => setTimeout(resolve, waitTimeInMs));
const graylog2 = require("graylog2");
const md5 = require('md5');
const moment = require("moment");
let logger1 = undefined
let logger2 = undefined
let remoteLogging1 = false
let remoteLogging2 = false
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
            async function sendRandomText(input, forceUpdate) {
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
            async function sendRandomEmbed(input, forceUpdate) {
                const itemResults = await sqlQuery(`SELECT kanmi_records.* FROM kanmi_records, kanmi_channels WHERE kanmi_records.channel = kanmi_channels.channelid AND ${(input.search) ? '( ' + input.search + ') AND ' : ''}(attachment_hash IS NOT NULL OR cache_url IS NOT NULL) AND attachment_extra IS NULL AND cache_extra IS NULL ORDER BY RAND() LIMIT 1`,);
                if (itemResults.rows.length === 1) {
                    const item = itemResults.rows[0];
                    const metadata = await sqlQuery('SELECT DISTINCT discord_servers.`serverid` as server, discord_servers.`name`, discord_servers.`nice_name` AS server_nice, discord_servers.`avatar`, kanmi_channels.`name` AS channel, kanmi_channels.`nice_name` AS channel_nice, sequenzia_class.`name` AS class, sequenzia_superclass.`uri` AS uri FROM discord_servers, kanmi_channels, sequenzia_class, sequenzia_superclass WHERE discord_servers.`serverid` = kanmi_channels.`serverid` AND kanmi_channels.`channelid` = ? AND sequenzia_class.`class` = kanmi_channels.`classification` AND sequenzia_superclass.`super` = sequenzia_class.`super` LIMIT 1', [item.channel]);
                    if (metadata.rows.length === 1) {
                        const meta = metadata.rows[0];
                        let embed = {
                            title: `${meta.class} / ${(meta.channel_nice)? meta.channel_nice : meta.channel.split('-').join(' ')}`,
                            url: `https://seq.moe/${meta.uri}?channel=random&search=eid:${item.eid}&nsfw=true`,
                            timestamp: item.date,
                            color: (item.colorR && item.colorG && item.colorB) ? (item.colorR << 16) + (item.colorG << 8) + item.colorB : "16095753",
                            footer: {
                                text: (meta.server_nice) ? meta.server_nice : meta.name,
                                icon_url: `https://cdn.discordapp.com/icons/${meta.server}/${meta.avatar}.png`
                            }
                        };
                        let url
                        if (item.attachment_hash) {
                            url = `https://media.discordapp.net/attachments/` + ((item.attachment_hash.includes('/')) ? item.attachment_hash : `${item.channel}/${item.attachment_hash}/${item.attachment_name}`)
                        } else if (item.cache_url) {
                            url = item.cache_url;
                        }
                        if (accepted_image_types.indexOf(url.split('.').pop().toLowerCase())) {
                            embed.image = {
                                "url": url
                            }
                        }

                        let messageText = " ";
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
                        } else if (item.content_full.includes('🏷 Name:')) {
                            messageText = item.content_full.split("\n").filter((e, i) => {
                                if (i > 1) {
                                    return e
                                }
                            }).join("\n")
                            if (messageText.length < 4)
                                messageText = undefined
                        } else if (item.content_full && item.content_full.length >= 2 && item.content_full !== item.attachment_name) {
                            messageText = item.content_full
                        }
                        let isNotFavorited = null
                        if (input.fav_userid)
                            isNotFavorited = ((await sqlQuery(`SELECT eid FROM sequenzia_favorites WHERE eid = ? AND userid = ? LIMIT 1`, [item.eid, input.fav_userid])).rows.length === 0)
                        if ((input.updateOnly === 1 || forceUpdate) && input.lastmessage) {
                            discordClient.editMessage(input.channel, input.lastmessage, { content: messageText, embed: embed })
                                .then(async (msg) => {
                                    await discordClient.removeMessageReactions(msg.channel.id, msg.id)
                                    printLine("Randomizer", `Sent ${item.attachment_name} to ${msg.channel.id}`, "info");
                                    await sqlQuery(`UPDATE seqran_channels SET lasteid = ?, lastmodify = NOW() WHERE channel = ? AND search = ?`, [item.eid, input.channel, input.search])
                                    await discordClient.addMessageReaction(msg.channel.id, msg.id, '🔀')
                                    if (input.fav_userid && isNotFavorited)
                                        await discordClient.addMessageReaction(msg.channel.id, msg.id, '❤')
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
                                            await sqlQuery(`UPDATE seqran_channels SET lastmessage = ?, lasteid = ?, lastmodify = NOW() WHERE channel = ?`, [msg.id, item.eid, input.channel])
                                        } else {
                                            await sqlQuery(`UPDATE seqran_channels SET lastmessage = ?, lasteid = ?, lastmodify = NOW() WHERE channel = ? AND search = ?`, [msg.id, item.eid, input.channel, input.search])
                                        }
                                    }
                                    await discordClient.addMessageReaction(msg.channel.id, msg.id, '🔀')
                                    if (input.fav_userid && isNotFavorited)
                                        await discordClient.addMessageReaction(msg.channel.id, msg.id, '❤')
                                })
                                .catch((err) => SendMessage(`Error sending random item to ${input.channel} - ${err.message}`, "error", 'main', "Randomizer", err))
                        }

                        if (input.displayname && input.fav_userid) {
                            const isExsists = await sqlQuery(`SELECT * FROM sequenzia_display_history WHERE eid = ? AND user = ?`, [item.eid, input.fav_userid]);
                            if (isExsists.error) {
                                printLine('SQL', `Error adding messages to display history - ${isExsists.error.sqlMessage}`, 'error', err)
                            }
                            if (isExsists.rows.length > 0) {
                                const updateHistoryItem = await sqlQuery(`UPDATE sequenzia_display_history SET screen = ?, name = ?, date = ? WHERE eid = ? AND user = ?`, [0, 'ADSEmbed-' + input.displayname, moment().format('YYYY-MM-DD HH:mm:ss'), item.eid, input.fav_userid])
                                if (updateHistoryItem.error) {
                                    printLine('SQL', `Error adding messages to display history - ${updateHistoryItem.error.sqlMessage}`, 'error', err)
                                } else {
                                    printLine('GetData', `Updated Image "${item.id}" to Display History for "${input.displayname}"`, 'debug')
                                }
                            } else {
                                const updateHistoryItem = await sqlQuery(`INSERT INTO sequenzia_display_history SET eid = ?, name = ?, screen = ?, user = ?, date = ?`, [item.eid, 'ADSEmbed-' + input.displayname, 0, input.fav_userid, moment().format('YYYY-MM-DD HH:mm:ss')])
                                if (updateHistoryItem.error) {
                                    printLine('SQL', `Error adding messages to display history - ${updateHistoryItem.error.sqlMessage}`, 'error', err)
                                } else {
                                    printLine('GetData', `Saving Image "${item.id}" to Display History for "${input.displayname}"`, 'debug')
                                }
                            }
                            sqlQuery(`DELETE a FROM sequenzia_display_history a LEFT JOIN (SELECT eid AS keep_eid, date FROM sequenzia_display_history WHERE user = ? AND name = ? ORDER BY date DESC LIMIT ?) b ON (a.eid = b.keep_eid) WHERE b.keep_eid IS NULL AND a.user = ? AND a.name = ?;`, [input.fav_userid, 'ADSEmbed-' + input.displayname, 500, input.fav_userid, 'ADSEmbed-' + input.displayname])
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
                    safeSQL(`SELECT * FROM seqran_channels WHERE channel = ? AND lastmessage = ? ORDER BY lastmodify DESC LIMIT 1`, [msg.channel.id, msg.id], (err, channels) => {
                        if (err) {
                            SendMessage(`Error getting channel configuration`, "error", 'main', "SQL", err)
                        } else if (channels.length > 0) {
                            if (channels[0].search) {
                                sendRandomEmbed(channels[0], true);
                            } else {
                                sendRandomText(channels[0], true);
                            }
                        }
                    })
                } else if (user.id !== discordClient.user.id && emoji.name === '❤') {
                    safeSQL(`SELECT * FROM seqran_channels WHERE channel = ? AND lastmessage = ? ORDER BY lastmodify DESC LIMIT 1`, [msg.channel.id, msg.id], (err, channels) => {
                        if (err) {
                            SendMessage(`Error getting channel configuration`, "error", 'main', "SQL", err)
                        } else if (channels.length > 0) {
                            discordClient.removeMessageReactions(msg.channel.id, msg.id)
                            safeSQL(`SELECT * FROM sequenzia_favorites WHERE eid = ? AND userid = ? LIMIT 1`, [channels[0].lasteid, channels[0].fav_userid], async (err, found) => {
                                await discordClient.addMessageReaction(msg.channel.id, msg.id, '🔀')
                                if (found.length === 0 && !err) {
                                    safeSQL(`INSERT INTO sequenzia_favorites SET eid = ?, userid = ?`, [channels[0].lasteid, channels[0].fav_userid], async (err, result) => {
                                        if (err) {
                                            printLine("Favorite", `Unable to favorite ${channels[0].lasteid} for ${channels[0].fav_userid}`, 'error', err)
                                            await discordClient.addMessageReaction(msg.channel.id, msg.id, '❤')
                                        }
                                    })
                                }
                            })
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
                    registerTimers();
                    setInterval(registerTimers, 60000)
                    setTimeout(() => {
                        discordClient.editStatus( "online",{
                            name: 'alexa',
                            type: 3
                        })
                    }, 5000)
                    init = 1;
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
