'use strict';

const { connect, createLocalVideoTrack, Logger, LocalDataTrack } = require('twilio-video');
const { isMobile } = require('./browser');

const $leave = $('#leave-room');
const $room = $('#room');
const $activeParticipant = $('div#active-participant > div.participant.main', $room);
const $activeVideo = $('video', $activeParticipant);
const $participants = $('div#participants', $room);

const muteUnmuteController = require('./muteUnmutecontroller');
const ChatDataTrackController = require('./sendAndReceiveController');
const SnapShotController = require('./SnapshotController');

const chatDataTrack = new LocalDataTrack({
  name: 'chat',
});

// The current active Participant in the Room.
let activeParticipant = null;

// Whether the user has selected the active Participant by clicking on
// one of the video thumbnails.
let isActiveParticipantPinned = false;

/**
 * Set the active Participant's video.
 * @param participant - the active Participant
 */
function setActiveParticipant(participant) {
  if (activeParticipant) {
    const $activeParticipant = $(`div#${activeParticipant.sid}`, $participants);
    $activeParticipant.removeClass('active');
    $activeParticipant.removeClass('pinned');

    // Detach any existing VideoTrack of the active Participant.
    const { track: activeTrack } = Array.from(activeParticipant.videoTracks.values())[0] || {};
    if (activeTrack) {
      activeTrack.detach($activeVideo.get(0));
      $activeVideo.css('opacity', '0');
    }
  }

  // Set the new active Participant.
  activeParticipant = participant;
  const { identity, sid } = participant;
  const $participant = $(`div#${sid}`, $participants);

  $participant.addClass('active');
  if (isActiveParticipantPinned) {
    $participant.addClass('pinned');
  }

  // Attach the new active Participant's video.
  const { track } = Array.from(participant.videoTracks.values())[0] || {};
  if (track) {
    track.attach($activeVideo.get(0));
    $activeVideo.css('opacity', '');
  }

  // Set the new active Participant's identity
  $activeParticipant.attr('data-identity', identity);
}

/**
 * Set the current active Participant in the Room.
 * @param room - the Room which contains the current active Participant
 */
function setCurrentActiveParticipant(room) {
  const { dominantSpeaker, localParticipant } = room;
  setActiveParticipant(dominantSpeaker || localParticipant);
}

/**
 * Set up the Participant's media container.
 * @param participant - the Participant whose media container is to be set up
 * @param room - the Room that the Participant joined
 */
function setupParticipantContainer(participant, room) {
  const { identity, sid } = participant;

  // Add a container for the Participant's media.
  const $container = $(`<div class="participant" data-identity="${identity}" id="${sid}">
    <audio autoplay ${participant === room.localParticipant ? 'muted' : ''} style="opacity: 0"></audio>
    <video autoplay muted playsinline style="opacity: 0"></video>
  </div>`);

  // Toggle the pinning of the active Participant's video.
  $container.on('click', () => {
    if (activeParticipant === participant && isActiveParticipantPinned) {
      // Unpin the RemoteParticipant and update the current active Participant.
      setVideoPriority(participant, null);
      isActiveParticipantPinned = false;
      setCurrentActiveParticipant(room);
    } else {
      // Pin the RemoteParticipant as the active Participant.
      if (isActiveParticipantPinned) {
        setVideoPriority(activeParticipant, null);
      }
      setVideoPriority(participant, 'high');
      isActiveParticipantPinned = true;
      setActiveParticipant(participant);
    }
  });

  // Add the Participant's container to the DOM.
  $participants.append($container);
}

/**
 * Set the VideoTrack priority for the given RemoteParticipant. This has no
 * effect in Peer-to-Peer Rooms.
 * @param participant - the RemoteParticipant whose VideoTrack priority is to be set
 * @param priority - null | 'low' | 'standard' | 'high'
 */
function setVideoPriority(participant, priority) {
  participant.videoTracks.forEach(publication => {
    const track = publication.track;
    if (track && track.setPriority) {
      track.setPriority(priority);
    }
  });
}

/**
 * Attach a Track to the DOM.
 * @param track - the Track to attach
 * @param participant - the Participant which published the Track
 */
function attachTrack(track, participant) {
  // Attach the Participant's Track to the thumbnail.
  if(track.kind === "data")
    return;
  
  const $media = $(`div#${participant.sid} > ${track.kind}`, $participants);
  $media.css('opacity', '');
  track.attach($media.get(0));

  // If the attached Track is a VideoTrack that is published by the active
  // Participant, then attach it to the main video as well.
  if (track.kind === 'video' && participant === activeParticipant) {
    track.attach($activeVideo.get(0));
    $activeVideo.css('opacity', '');
  }
}

/**
 * Detach a Track from the DOM.
 * @param track - the Track to be detached
 * @param participant - the Participant that is publishing the Track
 */
function detachTrack(track, participant) {
  // Detach the Participant's Track from the thumbnail.
  if(track.kind === "data")
    return;
  const $media = $(`div#${participant.sid} > ${track.kind}`, $participants);
  const mediaEl = $media.get(0);
  $media.css('opacity', '0');
  track.detach(mediaEl);
  mediaEl.srcObject = null;

  // If the detached Track is a VideoTrack that is published by the active
  // Participant, then detach it from the main video as well.
  if (track.kind === 'video' && participant === activeParticipant) {
    const activeVideoEl = $activeVideo.get(0);
    track.detach(activeVideoEl);
    activeVideoEl.srcObject = null;
    $activeVideo.css('opacity', '0');
  }
}

/**
 * Handle the Participant's media.
 * @param participant - the Participant
 * @param room - the Room that the Participant joined
 */
function participantConnected(participant, room) {
  // Set up the Participant's media container.
  setupParticipantContainer(participant, room);

  // Handle the TrackPublications already published by the Participant.
  participant.tracks.forEach(publication => {
    trackPublished(publication, participant);
  });

  // Handle theTrackPublications that will be published by the Participant later.
  participant.on('trackPublished', publication => {
    trackPublished(publication, participant);
  });

  appendText(`${participant.identity} has connected`);
}

/**
 * Handle a disconnected Participant.
 * @param participant - the disconnected Participant
 * @param room - the Room that the Participant disconnected from
 */
function participantDisconnected(participant, room) {
  // If the disconnected Participant was pinned as the active Participant, then
  // unpin it so that the active Participant can be updated.
  if (activeParticipant === participant && isActiveParticipantPinned) {
    isActiveParticipantPinned = false;
    setCurrentActiveParticipant(room);
  }

  // Remove the Participant's media container.
  $(`div#${participant.sid}`, $participants).remove();
}

/**
 * Handle to the TrackPublication's media.
 * @param publication - the TrackPublication
 * @param participant - the publishing Participant
 */
function trackPublished(publication, participant) {
  // If the TrackPublication is already subscribed to, then attach the Track to the DOM.
  if (publication.track) {
    attachTrack(publication.track, participant);
  }

  // Once the TrackPublication is subscribed to, attach the Track to the DOM.
  publication.on('subscribed', track => {
    attachTrack(track, participant);
  });

  // Once the TrackPublication is unsubscribed from, detach the Track from the DOM.
  publication.on('unsubscribed', track => {
    detachTrack(track, participant);
  });
}

/**
 * Join a Room.
 * @param token - the AccessToken used to join a Room
 * @param connectOptions - the ConnectOptions used to join a Room
 */
var roomP1;
async function joinRoom(token, connectOptions) {
  // Comment the next two lines to disable verbose logging.
  //console.log('In join room function!!');
  // const logger = Logger.getLogger('twilio-video');
  // logger.setLevel('debug');

  // Join to the Room with the given AccessToken and ConnectOptions.
  const room = await connect(token, connectOptions);
  roomP1 = room;
  // Save the LocalVideoTrack.
  let localVideoTrack = Array.from(room.localParticipant.videoTracks.values())[0].track;

  //publishing the DataTrack for chat
  try{
    var publishRes = await room.localParticipant.publishTrack(chatDataTrack);
    console.log("Data Track published!!", publishRes);
  }catch(err){
    console.log("Failed to publish the data track",err);
  }

  // Make the Room available in the JavaScript console for debugging.
  window.room = room;

  // Handle the LocalParticipant's media.
  participantConnected(room.localParticipant, room);

  // Subscribe to the media published by RemoteParticipants already in the Room.
  room.participants.forEach(participant => {
    participantConnected(participant, room);
  });

  // Subscribe to the media published by RemoteParticipants joining the Room later.
  room.on('participantConnected', participant => {
    participantConnected(participant, room);
    displayState(participant,"Connected");
  });

  // Handle a disconnected RemoteParticipant.
  room.on('participantDisconnected', participant => {
    participantDisconnected(participant, room);
    displayState(participant,"Disconnected");
    console.log(`Disconnected here :${participant}`);
  });

  // Setting the Reconnect Events 
  ReconnectStatusUpdate(room);
  
  // Set the current active Participant.
  setCurrentActiveParticipant(room);

  // Update the active Participant when changed, only if the user has not
  // pinned any particular Participant as the active Participant.
  room.on('dominantSpeakerChanged', () => {
    if (!isActiveParticipantPinned) {
      setCurrentActiveParticipant(room);
    }
  });

  // Leave the Room when the "Leave Room" button is clicked.
  $leave.click(function onLeave() {
    $leave.off('click', onLeave);
    room.disconnect();
  });

  return new Promise((resolve, reject) => {
    // Leave the Room when the "beforeunload" event is fired.
    window.onbeforeunload = () => {
      room.disconnect();
    };

    if (isMobile) {
      // TODO(mmalavalli): investigate why "pagehide" is not working in iOS Safari.
      // In iOS Safari, "beforeunload" is not fired, so use "pagehide" instead.
      window.onpagehide = () => {
        room.disconnect();
      };

      // On mobile browsers, use "visibilitychange" event to determine when
      // the app is backgrounded or foregrounded.
      document.onvisibilitychange = async () => {
        if (document.visibilityState === 'hidden') {
          // When the app is backgrounded, your app can no longer capture
          // video frames. So, stop and unpublish the LocalVideoTrack.
          localVideoTrack.stop();
          room.localParticipant.unpublishTrack(localVideoTrack);
        } else {
          // When the app is foregrounded, your app can now continue to
          // capture video frames. So, publish a new LocalVideoTrack.
          localVideoTrack = await createLocalVideoTrack(connectOptions.video);
          await room.localParticipant.publishTrack(localVideoTrack);
        }
      };
    }

    room.once('disconnected', (room, error) => {
      // Clear the event handlers on document and window..
      window.onbeforeunload = null;
      if (isMobile) {
        window.onpagehide = null;
        document.onvisibilitychange = null;
      }

      // Stop the LocalVideoTrack.
      localVideoTrack.stop();

      // Handle the disconnected LocalParticipant.
      participantDisconnected(room.localParticipant, room);

      // Handle the disconnected RemoteParticipants.
      room.participants.forEach(participant => {
        participantDisconnected(participant, room);
      });

      // Clear the active Participant's video.
      $activeVideo.get(0).srcObject = null;

      // Clear the Room reference used for debugging from the JavaScript console.
      window.room = null;

      if (error) {
        // Reject the Promise with the TwilioError so that the Room selection
        // modal (plus the TwilioError message) can be displayed.
        reject(error);
      } else {
        // Resolve the Promise so that the Room selection modal can be
        // displayed.
        resolve();
      }
    });
  });


}

// Implementing Mute and Unmute Audio/Video here (example-1)
const muteAudioBtn = document.getElementById("audioBtn");
const muteVideoBtn = document.getElementById("videoBtn")
muteAudioBtn.onclick = () => {
  const mute = !muteAudioBtn.classList.contains('muted');

  if(mute) {
    muteUnmuteController.muteYourAudio(roomP1);
    muteAudioBtn.classList.add('muted');
    muteAudioBtn.innerHTML = `Enable Audio &nbsp; <i class="fas fa-volume-up "></i>`
  } else {
    muteUnmuteController.unmuteYourAudio(roomP1);
    muteAudioBtn.classList.remove('muted');
    
    muteAudioBtn.innerHTML = `Disable Audio &nbsp; <i class="fas fa-volume-mute"></i>`
  }
}

muteVideoBtn.onclick = async () => {

  const mute = !muteVideoBtn.classList.contains('muted');
  let SnapBtn = document.getElementById("SnapBtn");

  if(mute) {
    muteUnmuteController.muteYourVideo(roomP1);
    muteVideoBtn.classList.add('muted');
    SnapBtn.disabled = true;

    //roomP1.localParticipant.tracks.forEach(track => detachTrack(track,roomP1.localParticipant));
    muteVideoBtn.innerText = 'Enable Video';
  } else {
    muteUnmuteController.unmuteYourVideo(roomP1);
    muteVideoBtn.classList.remove('muted');
    SnapBtn.disabled = false;
    //await roomP1.localParticipant.tracks.forEach(track => attachTrack(track,roomP1.localParticipant));
    muteVideoBtn.innerText = 'Disable Video';
  }
}

// Disconnect from the Room
window.onbeforeunload = () => {
  roomP1.disconnect();
  roomP2.disconnect();
  roomName = null;
}

// End


// Implementing example-2 chat box

const MsgSender = document.getElementById("msg-send");
const MsgInput = document.getElementById("input-msg");
const ChatForm = document.getElementById("chat-form");
const ChatBox = document.getElementById("chat-box");
//
let localDataTrack = null;

MsgSender.addEventListener('click',MsgSubmit);

function createMessages(message,direction){

  const dElement = document.createElement('div');
  dElement.className = 'message';

  console.log(direction === 'sent');
  dElement.classList.add(direction);
  dElement.innerText = `${message}`;

  return dElement;
  //div class="message received">Hello there!</div>
}

function appendText(text) {
  //var chatIdentity = roomP1.localParticipant.identity;
  ChatBox.appendChild(createMessages(text,'received'));
  ChatBox.scrollTop = ChatBox.scrollHeight;
}

function MsgSubmit(event) {
  event.preventDefault();

  var chatIdentity = roomP1.localParticipant.identity;
  const msg = `${chatIdentity} : ${MsgInput.value}`;
  ChatForm.reset();
  ChatBox.appendChild(createMessages(msg,'sent'));
  console.log(`${chatIdentity} has sent a message ${msg}`)
  ChatDataTrackController.sendChatMessage(chatDataTrack, msg);
  ChatBox.scrollTop = ChatBox.scrollHeight;

  ChatDataTrackController.receiveChatMessages(roomP1, appendText);      // this is the problem
}

// End

// Example - 3, Snapshot implementation

const SnapBtn = document.getElementById("SnapBtn");
var canvas = document.querySelector('.snapshot-canvas');
var img = document.querySelector('.snapshot-img');
var video = document.querySelector('video#videoinputpreview');
var localVideoTrack;
var el;

window.onload = () => {

  el = window.ImageCapture ? img : canvas;
  //el.classList.remove('hidden');

  el.width = "1280"
  //localVideoTrack.dimensions.width;
  el.height = "720"
  //localVideoTrack.dimensions.height;
}
SnapBtn.onclick = () => {

  if(!muteVideoBtn.classList.contains("muted")){
  let localVideoTrack = Array.from(room.localParticipant.videoTracks.values())[0].track;
  SnapShotController.takeLocalVideoSnapshot(video,localVideoTrack,el);
  }else{
    console.log("Video is stopped. Enable to take a screenshot!");
    setTimeout(function(){
      window.alert = "";
  }, 3000);
  }

}

// End

// Example - 4 , Reconnection Handler

// Funciton to display change of state in UI
function displayState(participant,state){

  let containerDiv = document.getElementsByClassName('container-fluid')[0];
 //let storeContainerDiv = containerDiv;
  //let statusPara = document.getElementsByClassName('state-color')[0];

  //if(!statusPara){
    let statusPara = document.createElement('p');
    statusPara.className = 'state-color';
    statusPara.innerText = `${participant.identity} ${state}`;
    containerDiv.prepend(statusPara);
  //}
  
  // else{
  //   statusPara.innerText = `${participant.identity} ${state}`;
  // }

  setTimeout(()=>{
    statusPara.remove();  
  },3000);
}

// Function to Update the Reconnecting state trigger of a participant, called on line 283
function ReconnectStatusUpdate(roomP1){
  roomP1.on('participantReconnecting', participant => {
    assert.equals(participant.state, 'connected');
    console.log(`${participant.identity} is reconnecting the signaling connection to the Room!`);
    displayState(participant,"Reconnecting");
    /* Update the RemoteParticipant UI here */
  });

  roomP1.on('participantReconnected', participant => {
    assert.equals(participant.state, 'connected');
    console.log(`${participant.identity} has reconnected the signaling connection to the Room!`);
    displayState(participant,"Reconnected");
    /* Update the RemoteParticipant UI here */
  });
}
// End
module.exports = joinRoom;
