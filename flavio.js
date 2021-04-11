const Discord = require('discord.js');
const {Wit, log} = require('node-wit');
const {spawn} = require('child_process');
const stream = require('stream');
const util = require('util');
const client = new Discord.Client();
const _ = require('underscore');
const discordTTS=require("discord-tts");
const fetch = require("node-fetch");
const config = require('./config')

const { analyze } = require('./wit.js');
const { MusicPlayer } = require('./play_music.js');

const prefix = "!flavio ";
const fs = require('fs');

// music player
const player = new MusicPlayer();

const kenku = require('./kenku.json');

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

function join(channel) {
    channel.join();
}

/**
 *  Have Flavio speak in a kenku like manner using learned phrases and text to speech
 *  
 * @param {string} words the words for Flavio to say
 * @param {connection} connection the connection to the voice channel Flavio will speak in
 */
function kenkuify(words, connection){
    /**
     *  A recursive function to replace words with saved audio files. 
     *  Uses a greedy search to replaces phrases with file paths
     *  
     * @param {string} substring the words that still need replacing
     * @param {json} kenku contains file paths to learned words
     * @param {list} keys the sorted list of phrases that Flavio knows. The keys to kenku
     */
    function audio_array(substring,kenku,keys){
        var arr = new Array();
        var arrRight = new Array();
        var arrLeft = new Array();

        substring = substring.trim();
        // If there are no more words, return the empty array
        if(substring.length===0){
            return arr;
        }

        var index = -1;
        var key;
        for(const i in keys){
            key = keys[i];

            var regex = new RegExp('\\b' + key + '\\b');
            index = substring.search(regex);
            // If a match is found, replace it with the path and split on either side to search the two substrings
            if(index !== -1){

                arr.push(kenku[key])
            
                if(index === 0){
                    arrRight = audio_array(substring.slice(index+key.length),kenku,keys)
                    return arr.concat(arrRight)
                }
                
                arrLeft = audio_array(substring.slice(0,index-1),kenku,keys)
                arrRight = audio_array(substring.slice(index+key.length),kenku,keys)
                return arrLeft.concat(arr,arrRight)
            }
        }
        // If words exist that Flavio has learned, return them as strings to the array as tts will handle them
        arr.push(substring)

        // base case
        return arr;
    }
    fs.readFile("kenku.json", async (err, data) => {
        var arr = new Array();
        // Check for errors
        if (err) throw err;
       
        // Read in kenku.json and sort keys in descending order
        const voices = JSON.parse(data);
        keys = Object.keys(voices).sort(function(a, b){
            return b.length - a.length;
          });
        
        // transform input words into a sentence of files for Flavio to speak
        var sentence = audio_array(words,voices,keys)

        await speak_kenku(connection, sentence);
    });
}

/**
 * 
 * @param {VoiceChannel} VoiceChannel to disconnect from  
 * @param {TextChannel} TextChannel to say goodbye message in 
 */
function leave_channel(voice_channel, text_channel){
    if (voice_channel) {
        if (player.dispatcher) player.dispatcher.end();
        voice_channel.leave();
        text_channel.send('see ya');
        if (player.queue.length > 0) player.clear_queue(text_channel);
    } 
}

/**
 * Sends a random meme into the specified channel
 * @param {channel} channel the channel Flavio sends the meme to
 */
function send_meme(channel){
    fetch('https://meme-api.herokuapp.com/gimme')
        .then(res => res.json())
        .then(json => {
            // 👀👀👀
            // 🦧🚀🚀
          const meme_zone = new Discord.MessageEmbed()
          .setTitle(json.title)
          .setImage(json.url)
          .setFooter(`Link: ${json.postLink} | Subreddit: ${json.subreddit}`)
           channel.send(meme_zone);
        });
}

/**
 * 
 * @param {VoiceConnection} VoiceConnection to use 
 * @param {Array<String>} Collection of saved filenames containing stereo pcm s16le audio
 * Merges audio with the MusicPlayer and will determine whether or not to use TTS vs file
 */
async function speak_kenku(connection, sentence) {
    var streams = [] 
    for(let phrase of sentence) {
        streams.push((phrase.length > 6 && phrase.slice(0, 7) === "./kenku") ? fs.createReadStream(phrase) : discordTTS.getVoiceStream(phrase));
    }
    await player.kenkuMerge(sentence, connection);
}

////////////////////////////////////////////
var learn = false

/**
 * Flavio command handling
 */
client.on('message', async msg => {
    if(!msg.content.startsWith(prefix) || msg.author.bot) return;
    
    const args = msg.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    
    //Enables learn mode while Flavio is listening with the ping command
    //While in learn mode, Flavio will automatically turn your words into audio files
    //Later, you can type !flavio kenku {text} to have Flavio
    //Say the text in the audio samples you provided for it
    if (command === 'learn'){
        learn = true
    }
    
    //Volume command
    //Not working, except for mimic (volume warning)
    else if(command === 'volume'){
        volume = parseInt(args[0])*1;
        player.setVolume(volume);
        console.log(volume);
    }

    //Flavio joins the current voice channel and listens to what participants say
    //If a valid voice command is issued, Flavio will take the appropriate action
    //Otherwise, he will just make his best guess at what you're saying and send it back to you in the chat
    if (command === 'listen') {
        msg.channel.send(":ear: :eyes: :ear:")
        const connection = await msg.member.voice.channel.join();
        
        /**
         * Flavio voice command handling
         */ 
        connection.on('speaking', (user, speaking) => {
            if (!speaking) {
                return
            }
            console.log(`I'm listening to ${user.username}`);
            //Flavio will write audio files while in learn mode
            const audio = connection.receiver.createStream(user, { mode: 'pcm' });
            if (learn){
                const file_name = "./kenku/" + String(Math.floor(new Date()));
                audio.pipe(fs.createWriteStream(file_name));
            }
            var buffer = [];
            audio.on('data', data => {
                buffer.push(data)
            });
            audio.on('end', async () => {
                //Write audio to a buffer and try to convert it to text
                var buf = Buffer.concat(buffer)
                const duration = buf.length / 48000 / 4;
                //Make sure audio isn't too short or too long
                if (duration < 1 || duration > 19) return;
                const r = await analyze(buf);
                var text = r['text'];
                var intents = r['intents'];
                //Determine if the user has issued a command
                if(typeof intents !== 'undefined' && intents.length>0){
                    const min_confidence = 0.75
                    intent = intents[0]
                    if(intent.name === 'music_play') {
                        console.log("Text is")
                        console.log(text);
                        var param = [r.entities['song:song'][0]["body"]];
                        console.log(r.entities);
                        player.play(msg.member.voice.channel, param, msg.channel);
                    }
                    //Flavio will skip the current song in the queue
                    else if(intent.name === 'music_skip' && intent.confidence > min_confidence){
                        console.log("skip");
                        player.skip_queue(msg.channel);
                    }
                    // Flavio will leave the current voice channel
                    else if(intent.name === "leave_channel" && intent.confidence > min_confidence){
                        msg.channel.send("My ears are sealed");
                        leave_channel(msg.member.voice.channel, msg.channel);
                    }
                    //Flavio will pause the music, if it is playing
                    else if(intent.name === "music_pause" && intent.confidence > min_confidence){
                        console.log("Paused_music");
                        player.pause_audio(msg.channel);
                    }
                    //Flavio will resume the music, if it is paused
                    else if(intent.name === "music_resume" && intent.confidence > min_confidence){
                        console.log("music resuming");
                        player.resume_audio(msg.channel);
                    }
                    //Flavio will show the current music queue
                    else if(intent.name === "show_queue" && intent.confidence > min_confidence){
                        player.show_queue(msg.channel);
                    }
                    //Flavio will clear the current music queue
                    else if(intent.name === "clear_queue" && intent.confidence > min_confidence){
                        player.clear_queue(msg.channel);
                    }
                    //Flavio will hand-pick a random meme from reddit and send it
                    else if(intent.name === "meme" && intent.confidence > min_confidence) {
                        send_meme(msg.channel);
                    }
                }
                //If we're in learn mode, write dictionary entries to json file
                //For access later with !flavio kenku
                if(learn && typeof text !== 'undefined' && text.split(" ").length < 4){
                    console.log("LEARNING PHRASE")
                    fs.readFile("kenku.json", async (err, data) => {
      
                        // Check for errors
                        if (err) throw err;
                       
                        // Converting to JSON
                        const voices = JSON.parse(data);
                          
                        //console.log(voices); // Print voices
        
                        voices[text] = file_name;
        
                        fs.writeFile("kenku.json", JSON.stringify(voices), err => {
                 
                            // Checking for errors
                            if (err) throw err; 
                           
                            console.log("Done writing"); // Success
                        });
                    });
                }
                //Flavio repeats the message back to the user so they can see what
                //he thinks they said
                if(typeof text !== 'undefined') msg.channel.send(`${user.username}` + " says: " + text);
                //If the audio can't be processed into text (user mumbled, random noise, etc.)
                //Let the user know
                else msg.channel.send(`Sorry, ${user.username}, I didn't quite catch that...`);
            })
            
        })
    }

    /**
     * Flavio Text Command Handling
     */
    
    // 👂👄 mimicry time
    else if (command === `mimic`) {
        // does it contain mentions?
        let to_mimic = msg.mentions.members.entries().next().value ? msg.mentions.members.entries().next().value[1] : msg.member;
        
        // selection in order of API, first member is selected from mentions
        // if no mentions, user selected
        if(to_mimic.voice.channel) {
            console.log(`I'm mimicking ${to_mimic.user.username}`);
            const connection = await to_mimic.voice.channel.join();
            const audio = connection.receiver.createStream(to_mimic, { mode: 'pcm' });
            
            // full our buffer with audio data
            var buffer = [];

            audio.on('data', data => {
                buffer.push(data)
            });
    
            audio.on('end', async () => {
                console.log('done');
                var buf = Buffer.concat(buffer)
                const duration = buf.length / 48000 / 4;
                if (duration > 19) return;
                var rs = stream.Readable.from(buf);
                await player.mergeStreams(rs, connection);
            }); 
        }
    }
    // Pulls a random (appropriate) joke from jokeapi. Use kenkuify() to read the joke aloud
    else if (command === `joke`){
        const connection = await msg.member.voice.channel.join();
        url = "https://v2.jokeapi.dev/joke/Any?blacklistFlags=nsfw,religious,political,racist,sexist,explicit&type=single"
        fetch(url, {
            "method": "GET",
            "headers": {
                "x-rapidapi-key": config.jokeKey,
                "x-rapidapi-host": "jokeapi-v2.p.rapidapi.com"
            }
        })
        .then(response => response.json())
        .then(data => {
            console.log(data)
            text = data.joke.replace(/(\r\n|\n|\r)/gm, "");
        
            //text = "If you're here for the yodeling lesson, please form an orderly orderly orderly queue"
            kenkuify(text,connection)     
        })
        .catch(err => {
            console.error(err);
        });
    }
    //Flavio will show a random hand-picked meme from reddit's funniest subs like r/dankmemes
    else if (command === `meme`){
        send_meme(msg.channel);
    }
    //creepy jerma face
    else if (command === `amogus`){
        msg.channel.send('WHEN THE FLAVIO IS SUS??????????', {files: ['https://media.discordapp.net/attachments/629488030805131297/829695255560454154/unknown.png']});
    }
    //Flavio will join the voice channel of the user who summoned it
    else if (command === `join`){
        join(msg.member.voice.channel);
        msg.channel.send('hoppin in');
    }
    //Flavio will skip the current song
    else if (command === `skip`){
        player.skip_queue(msg.channel);
    }
    //Flavio will pause the music, if it is playing
    else if (command === `pause`){
        player.pause_audio(msg.channel);
    }
    //Flavio will resume the music, if it is paused
    else if (command === `resume`){
        player.resume_audio(msg.channel);
    }
    //Flavio will attempt to kenkuify text it is given
    else if (command === `kenku`){
        const connection = await msg.member.voice.channel.join();
        const words = args.join(" ").toLowerCase();
        kenkuify(words,connection)
    }
    //Flavio will attempt to learn only the next utterance of the user who summons it
    else if (command === `copy`){

        msg.channel.send(":ear: :eyes: :ear:");
        const file_name = "./kenku/" + String(Math.floor(new Date()));
        console.log(file_name);

        // Create a ReadableStream of s16le PCM audio
        const connection = await msg.member.voice.channel.join();
        const audio = connection.receiver.createStream(msg.member, { mode: 'pcm' });
        audio.pipe(fs.createWriteStream(file_name));
        var buffer = [];
        audio.on('data', data => {
            buffer.push(data)
        })
        audio.on('end', async () => {
            
            var buf = Buffer.concat(buffer);
            const duration = buf.length / 48000 / 4;
            if (duration < 1 || duration > 19) return;
            const r = await analyze(buf);
            var text = r['text'];
            console.log(text);
            
            
            fs.readFile("kenku.json", async (err, data) => {
      
                // Check for errors
                if (err) throw err;
               
                // Converting to JSON
                const voices = JSON.parse(data);
                  
                voices[text] = file_name;

                // Write additions to kenku.json
                fs.writeFile("kenku.json", JSON.stringify(voices), err => {
         
                    // Checking for errors
                    if (err) throw err; 
                   
                    console.log("Done writing"); // Success
                });
            });

        });

    }
    //Flavio will leave the current voice channel
    else if (command === `leave` || command === `fuckoff`){
        leave_channel(msg.member.voice.channel, msg.channel)
    }
    //peepo happy
    else if (command === `poggers`){
        const connection = await msg.member.voice.channel.join();
        msg.channel.send('poggers', {files: ["https://www.pinclipart.com/picdir/big/364-3648446_poggers-emote-clipart.png"]})
        kenkuify("poggers",connection);
    }
    //Flavio will attempt to play the given song
    else if (command === `play`){
        player.play(msg.member.voice.channel, args, msg.channel);
    }
    //Flavio will clear the music queue
    else if (command === `clear`){
        player.clear_queue(msg.channel);
    }
    //Flavio will display the current music queue
    else if (command === `q` || command === `queue`){
        player.show_queue(msg.channel);
    }
    //Flavio will remove the song at the given position from the music queue
    else if (command === `remove`){
        pos = parseInt(args[0])*1;
        player.remove_from_queue(pos, msg.channel);
    }
});



client.login(config.apiKey);