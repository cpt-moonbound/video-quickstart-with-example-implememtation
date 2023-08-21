function muteOrUnmuteYourMedia(room, kind, action) {
    const publications = kind === 'audio'
      ? room.localParticipant.audioTracks
      : room.localParticipant.videoTracks;
  
    publications.forEach(function(publication) {
      if (action === 'mute') {
        publication.track.disable();
      } else {
        publication.track.enable();
      }
    });
  }
  
  /**
   * Mute your audio in a Room.
   * @param {Room} room - The Room you have joined
   * @returns {void}
   */
  function muteYourAudio(room) {
    muteOrUnmuteYourMedia(room, 'audio', 'mute');
  }
  
  /**
   * Mute your video in a Room.
   * @param {Room} room - The Room you have joined
   * @returns {void}
   */
  function muteYourVideo(room) {
    muteOrUnmuteYourMedia(room, 'video', 'mute');
  }
  
  /**
   * Unmute your audio in a Room.
   * @param {Room} room - The Room you have joined
   * @returns {void}
   */
  function unmuteYourAudio(room) {
    muteOrUnmuteYourMedia(room, 'audio', 'unmute');
  }
  
  /**
   * Unmute your video in a Room.
   * @param {Room} room - The Room you have joined
   * @returns {void}
   */
  function unmuteYourVideo(room) {
    muteOrUnmuteYourMedia(room, 'video', 'unmute');
  }
  
  exports.muteYourAudio = muteYourAudio;
  exports.muteYourVideo = muteYourVideo;
  exports.unmuteYourAudio = unmuteYourAudio;
  exports.unmuteYourVideo = unmuteYourVideo;




  