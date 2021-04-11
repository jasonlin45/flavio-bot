const Discord = require('discord.js');
const fs = require('fs');
const ytdl = require("ytdl-core");
const yts = require( 'yt-search' );
const _ = require('lodash');
const discordTTS=require("discord-tts");

class MusicPlayer {
    constructor() {
        this._text_channel = undefined;
        this._voice_channel = undefined;
        this._dispatcher = undefined;
        this._playing = undefined;
        this._music = false;
        this._time = 0;
        this._queue = [];
        this._volume = 1;
    }

    get dispatcher() {
        return this._dispatcher;
    }

    setVolume(volume) {
        this._volume = volume;
        console.log(this._volume);
    }

    set dispatcher(dispatcher) {
        this._dispatcher = dispatcher;
    }

    *getQueue() {
        for(const song of this._queue) {
            yield song
        }
    }
    get queue() {
        return this._queue;
    }

    setTextChannel(text_channel) {
        this._text_channel = text_channel;
    }

    setVoiceChannel(voice_channel) {
        this._voice_channel = voice_channel;
    }

    
    /**
     * Plays an audio stream through the given voice connection
     * (private, will break the music player)
     * @param {VoiceConnection} VoiceConnection channel to play audio through 
     * @param {ReadableStream} incoming audio stream 
     * @param {StreamOptions} arguments to pass, see Discord.js doc for full list 
     */
    async playAudioStream(connection, stream, args={type: 'converted', volume: this._volume}) {
        this._dispatcher = connection.play(stream, args);
    }

    /**
     * Dispatcher is a singleton.  If a current song is playing, pause and save
     * time in song.  Then, dispatcher will play incoming stream.  Once done, resume
     * music stream accounting for passed time.
     * @param {ReadableStream} incoming stream
     * @param {VoiceConnection} current voice channel connection 
     */
    async mergeStreams(incoming, connection) {
        // If already playing
        if(this._dispatcher) {
            this._dispatcher.pause();
            if(this._music)
                this._time += Math.abs(this._dispatcher.streamTime * 1);
            this._music = false;
            console.log(this._time);
            this.playAudioStream(connection, incoming).then(
                (value) => {
                    this._dispatcher.on("finish", async () => {
                        if(this._playing)
                            this._queue.unshift(this._playing);
                        console.log("finish");
                        if(this._queue[0]) {
                            await this.play_yt(connection, this._queue[0], (this._time) / 1000);
                        }
                        else {
                            this._dispatcher = undefined;
                        }
                    });
                }
            );
        }
        else {
            this.playAudioStream(connection, incoming).then(
                (value) => {
                    this._dispatcher.on("finish", () => {
                        this._dispatcher = undefined;
                        this._time = 0;
                        this._music = false;
                    });
                }
            );
        }
    }

    /**
     * 
     * @param {Array<String>} incoming list of filenames to read streams from 
     * @param {VoiceConnection} voice channel to stream to 
     */
    async kenkuMerge(incomingList, connection) {
        if(this._dispatcher) {
            this._dispatcher.pause();
            if(this._music)
                this._time += this._dispatcher.streamTime
            this._music = false;
            await this._kenkuMerge(incomingList, connection, this._time)
        }
        else {
            await this._kenkuMerge(incomingList, connection);
        }
    }

    // Recursive helper function for kenku merging
    async _kenkuMerge(incomingList, connection, time=0) {
        if(incomingList[0]) {
            var phrase = incomingList[0];
            var args;
            var stream;
            if(phrase.length > 6 && phrase.slice(0, 7) === "./kenku"){
                args = {type: 'converted'}
                stream = fs.createReadStream(phrase);
            }
            else {
                args = {type: 'unknown'}
                stream = discordTTS.getVoiceStream(phrase);
            }
            this.playAudioStream(connection, stream, args).then(
                (value) => {
                    incomingList.shift();
                    this._dispatcher.on('finish', async () => {
                        if(incomingList[0])
                            await this._kenkuMerge(incomingList, connection, (time + Math.abs(this._dispatcher.totalStreamTime * 1)));
                        else {
                            if(this._playing)
                                this._queue.unshift(this._playing);
                            if(this._queue[0]) {
                                await this.play_yt(connection, this._queue[0], (time + Math.abs(this._dispatcher.totalStreamTime * 1)) / 1000);
                            }
                            else {
                                this._dispatcher = undefined;
                            }
                        }
                    })
                }
            );
        }
        else {
            return
        }
    }

    // sends a pretty banner to a text channel of song info
    send_song_info(text_channel, song) {

        const songEmbed = new Discord.MessageEmbed()
        .setColor('#0099ff')
        .setTitle(song["title"])
        .setURL(song["url"])
        .setAuthor('Flavio', 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcStYZp8l5_lvi1oOlHqg9vHKd2b3rWYlJrEuQ&usqp=CAU')
        .setDescription(song["description"])
        .setThumbnail(song["thumbnail"])
        .addField('Queue Position', this._queue.length-1, true)
        .setTimestamp();
    
        text_channel.send(songEmbed);
    }
    

    // searches youtube and returns a video
    async search(args) {
        var search = args.join(" ");
        const vid = await yts(search);
        var results = vid['all'];
        for(const result of results) {
            if(result.type === 'video')
                return result;
        }
    }
    
    /**
     * Play command.  Play a song to voice channel based on arg query
     * @param {VoiceChannel} voice channel to play audio through 
     * @param {Array<String>}  
     * @param {TextChannel} text channel to send messages through (song info, etc)
     */
    async play(channel, args, text_channel) {
        if(args.length > 0){  
            const connection = await channel.join();
            var song = await this.search(args);
            //console.log(song);
            this._queue.push(song);
            this.send_song_info(text_channel, song);
            if(typeof this._dispatcher === 'undefined') {
                await this.play_yt(connection, this._queue[0]);
            }
            else if(this._dispatcher.paused) {
                this.resume_audio(text_channel);
            }
        }
        else if(typeof this._dispatcher === 'undefined' || !this._queue[0]){
            text_channel.send("please specify a song to play");
        }
        else if(this._dispatcher.paused){
            this.resume_audio(text_channel); 
        }
        else {
            const connection = await channel.join();
            await this.play_yt(connection, this._queue[0]);
        }
    }
    
    /**
     * Plays a Youtube video
     * @param {VoiceConnection} voice connection to play through 
     * @param {Song} song object (yt-search)
     * @param {Number} Time in milliseconds offset from the start
     */
    async play_yt(connection, song, time=0) {
        this._time = time * 1000;
        this._music = true;
        this._playing = song;
        var id = song.videoId;
        this._dispatcher = connection.play(ytdl(id,{filter: 'audioonly'}), {seek: time}, {type: 'converted', volume: this._volume});
        //send_song_info(channel, song);
        this._queue.shift();
        this._dispatcher.on("finish", async () => {
            if(this._queue[0]) {
                await this.play_yt(connection, this._queue[0]);
            }
            else {
                this._playing = undefined;
                this._dispatcher = undefined;
            }
        });
    }
    
    // skip
    skip_queue(channel){
        if(this._dispatcher) {
            this._dispatcher.end();
            channel.send("Song skipped!");
            return true;
        }
        channel.send("No songs to skip!");
        return false;
    }
    
    //pause
    pause_audio(channel) {
        if(this._dispatcher) {
            channel.send("Song paused!");
            this._dispatcher.pause();
            return true;
        }
        channel.send("No song to pause!");
        return false;
    }
    
    //unpause
    resume_audio(channel) {
        if(this._dispatcher) {
            this._dispatcher.resume();
            channel.send("Resuming audio!");
            return true;
        }
        channel.send("No audio to resume!");
        return false;
    }
    
    //clears the queue
    clear_queue(channel){
        if (this._queue.length !== 0){
            this._queue = [];
            channel.send("Queue cleared!");
            return true;
        }
        channel.send("Queue's already empty!");
        return false;
    
    }

    //shows the songs in the queue
    show_queue(channel){
        var to_send = ""
            if (typeof this._queue !== 'undefined' && this._queue.length !== 0) {
                for (const [k,v] of Object.entries(this._queue)){
                    to_send += k + ": " + v["title"] + "\n";
                }
                channel.send(to_send);
            }
            else channel.send("No queue!");
    }

    //removes specific song from queue
    remove_from_queue(pos, channel) {
        if(typeof pos == 'number' && pos <= this._queue.length - 1 && pos >= 0){
            this._queue.splice(pos, 1);
            channel.send("Removed song at position " + pos + "!");
        }
        else{
            channel.send("Not a valid queue position!");
        }
    }
}

module.exports = { MusicPlayer };