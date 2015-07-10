/**
 * Created by syntaxfish on 15. 6. 28..
 */
(function() {
    "use strict";

    var config = require('config');
    var pushTypes = config.get('Push.SupportPushTypes');
    var DeviceBuffer = require('./lib/deviceBuffer');
    var PushAssociations = require('./lib/PushAssociations');

    var Rabbitmq = require('./lib/rabbitmq');
    var rabbitmq = new Rabbitmq();

    var PushManager = require('./lib/pushManager');
    var pushManager = new PushManager();

    var RedisManager = require('./lib/redisManager');
    var redisMananger = new RedisManager();


    rabbitmq.consume('notification', {}, function (err, job, ack) {
        if(err) { return process.exit(1); }
        var page = job.page;
        var itemPerPage = job.itemPerPage;
        var deviceBuffers = {};
        var condition = job.condition;
        var endBufferTypes = [];
        var payload = job.notification;
        var pushId = job.pushId;
        var countOfNotify = 0;

        // init device buffer
        pushTypes.forEach(function (type) {
            deviceBuffers[type] = new DeviceBuffer();
            deviceBuffers[type].addFlushListener(function (devices){
                // Send Push Notification
                if(devices.length > 0) {
                    _deDuplication(pushId, devices, function (err, deviceSet) {
                        countOfNotify = deviceSet.length;
                        pushManager.notify(type, deviceSet, payload);
                    });
                }
            });
            deviceBuffers[type].addEndListener(function (){
                endBufferTypes.push(type);

                // end
                if(endBufferTypes.length == Object.keys(deviceBuffers).length) {
                    if(job.isLast && countOfNotify === job.itemPerPage) {
                        // 마지막페이지가 마지막 페이지가 아니네..
                        job.page++;
                        rabbitmq.publish('notification',JSON.stringify(job), {});
                    } else {
                        // 진짜 마지막 페이지
                        PushAssociations.finishSendPush(job.pushId, function () {
                            console.log(arguments);

                        });
                    }
                    ack();
                }
            });
        });

        PushAssociations.find(condition, page * itemPerPage, itemPerPage, function(err, devices) {
            devices.forEach(function (device) {
                var buffer = deviceBuffers[device.pushType];
                if(!buffer) { return; }
                buffer.add(device.deviceToken);
            });

            // End Buffers
            Object.keys(deviceBuffers).forEach(function (type) {
                deviceBuffers[type].end();
            });
        });
    });

    process.on('uncaughtException', function(error) {
        console.log('[%d] uncaughtException : ', process.pid, error.stack);
        process.exit(1);
    });
    
    function _deDuplication(pushId, devices, callback){
        // TODO de-duplication
        var multi = redisMananger.write('push').multi();
        var redisKey = 'push:status:hash:'+pushId;

        for( var i = 0; i < devices.length; i++ ) {
            multi.sadd(redisKey, devices[i]);
        }

        multi.exec(function (err, result) {
            devices = devices.filter(function (v, i) {
                return result[i] === 1;
            });

            callback(err, devices);
        });
    };

})();