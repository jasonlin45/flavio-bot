const stream = require('stream');
const util = require('util');
const config = require('./config');

const WIT = config.witKey;

// Signed PCM 16 bit mono little endian
var content_type = "audio/raw;encoding=signed-integer;bits=16;rate=48k;endian=little";

// WIT API
const request = require('request');
const _ = require('underscore');

function accessHeaders(access_token, others) {
    return _.extend(others || {}, {
        'Authorization': 'Bearer ' + access_token
    });
};

// PCM Transform to mono

async function convert_to_mono(buffer) {
    var converted = Buffer.alloc(buffer.length / 2);

    for (let i = 0; i < converted.length / 2; i++) {
        const uint16 = buffer.readUInt16LE(i * 4);
        converted.writeUInt16LE(uint16, i * 2);
    }

    return converted;
}


//////////////////////////////

async function wit_speech_post(access_token, s, content_type, options, callback) {
    if (!callback) {
        callback = options;
        options = undefined;
    }

    query_params = _.extend({}, options);
    
    const request_options = {
        url: 'https://api.wit.ai/speech',
        qs: query_params, // may be empty object
        method: 'POST',
        json: true,
        headers: accessHeaders(access_token, {'Content-Type': content_type, 'Transfer-encoding': 'chunked'})
    };

    s.pipe(request.post(request_options, function(error, response, body) {
        if (response && response.statusCode != 200) {
            error = "Invalid response received from server: " + response.statusCode
            console.log(error);
        }
        callback(error, body);
    }));
}

let witAI_lastcallTS = null;

async function analyze(buffer) {
    var convertedBuffer = await convert_to_mono(buffer);

    try{
        if(witAI_lastcallTS != null) {
            let now = Math.floor(new Date());
            while (now - witAI_lastcallTS < 1000) {
                console.log('sleep')
                await sleep(100);
                now = Math.floor(new Date());
            }
        }
    }
    catch (e) {
        console.log('transcribe_witai 837:' + e)
    }

    let s = stream.Readable.from(convertedBuffer);
    const extract = util.promisify(wit_speech_post);
    const output = await extract(WIT, s, content_type);

    console.log(output);
    return output
}

module.exports = {
    analyze
}