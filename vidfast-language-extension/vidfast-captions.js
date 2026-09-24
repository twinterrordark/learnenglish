(function () {
  "use strict";
  if (!/^(vidfast\.pro|vidfast\.vc)$/.test(location.hostname)) return;

  var sent = new Set();
  var attached = new WeakSet();
  var lastReady = 0;
  var lastTimeSent = 0;
  var activeLangState = "en"; // "en", "tr", "off"
  var injectedTracks = { en: null, tr: null };

  function send(type, data) {
    try {
      window.top.postMessage(Object.assign({ source: "learnenglish-vidfast-bridge", type: type }, data || {}), "*");
    } catch (_) {}
  }

  function getLang(track) {
    var val = String((track && (track.language || track.label || track.id)) || "").toLowerCase();
    if (/(^|[^a-z])(tr|tur|turkish|türkçe)([^a-z]|$)/.test(val)) return "tr";
    if (/(^|[^a-z])(en|eng|english|ingilizce)([^a-z]|$)/.test(val)) return "en";
    return val || "en";
  }

  function emit(video, track, cue) {
    if (!cue) return;
    var lang = getLang(track);
    var text = String(cue.text || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    if (!text) return;
    var start = Number(cue.startTime);
    if (!Number.isFinite(start)) start = Number(video.currentTime) || 0;
    var key = lang + "|" + Math.floor(start * 4) + "|" + text;
    if (sent.has(key)) return;
    sent.add(key);
    if (sent.size > 800) sent.clear();

    send("CAPTION", {
      text: text,
      language: lang,
      label: String(track.label || track.language || (lang === "tr" ? "Türkçe" : "English")),
      start: start,
      end: Number(cue.endTime) || start + 2,
      currentTime: Number(video.currentTime) || start
    });
  }

  function setTrackModes(video, desiredLang) {
    activeLangState = desiredLang;
    var tracks = video.textTracks;
    if (!tracks) return;
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      var tLang = getLang(t);
      if (desiredLang === "off") {
        t.mode = "disabled";
      } else if (tLang === desiredLang) {
        t.mode = "showing";
      } else {
        t.mode = "disabled";
      }
    }
    send("TRACK_CHANGED", { activeLang: desiredLang });
  }

  function injectSubtitles(video, data) {
    if (!video || !data) return;

    // Remove existing injected tracks
    var existingDomTracks = video.querySelectorAll("track[data-injected='learnenglish']");
    for (var d = 0; d < existingDomTracks.length; d++) {
      existingDomTracks[d].remove();
    }

    var enCount = 0;
    var trCount = 0;

    // Inject English
    if (Array.isArray(data.enCues) && data.enCues.length > 0) {
      try {
        var enTrack = video.addTextTrack("subtitles", "English (LearnEnglish)", "en");
        for (var i = 0; i < data.enCues.length; i++) {
          var c = data.enCues[i];
          if (c.text && Number.isFinite(c.start) && Number.isFinite(c.end)) {
            enTrack.addCue(new VTTCue(c.start, c.end, c.text));
            enCount++;
          }
        }
        injectedTracks.en = enTrack;
      } catch (err) {
        console.warn("[VidFast Bridge] addTextTrack EN error:", err);
      }

      if (data.enVtt) {
        try {
          var blobEn = new Blob([data.enVtt], { type: "text/vtt" });
          var trackElEn = document.createElement("track");
          trackElEn.kind = "subtitles";
          trackElEn.label = "English (LearnEnglish)";
          trackElEn.srclang = "en";
          trackElEn.src = URL.createObjectURL(blobEn);
          trackElEn.setAttribute("data-injected", "learnenglish");
          video.appendChild(trackElEn);
        } catch (_) {}
      }
    }

    // Inject Turkish
    if (Array.isArray(data.trCues) && data.trCues.length > 0) {
      try {
        var trTrack = video.addTextTrack("subtitles", "Türkçe (LearnEnglish)", "tr");
        for (var j = 0; j < data.trCues.length; j++) {
          var cTr = data.trCues[j];
          if (cTr.text && Number.isFinite(cTr.start) && Number.isFinite(cTr.end)) {
            trTrack.addCue(new VTTCue(cTr.start, cTr.end, cTr.text));
            trCount++;
          }
        }
        injectedTracks.tr = trTrack;
      } catch (err) {
        console.warn("[VidFast Bridge] addTextTrack TR error:", err);
      }

      if (data.trVtt) {
        try {
          var blobTr = new Blob([data.trVtt], { type: "text/vtt" });
          var trackElTr = document.createElement("track");
          trackElTr.kind = "subtitles";
          trackElTr.label = "Türkçe (LearnEnglish)";
          trackElTr.srclang = "tr";
          trackElTr.src = URL.createObjectURL(blobTr);
          trackElTr.setAttribute("data-injected", "learnenglish");
          video.appendChild(trackElTr);
        } catch (_) {}
      }
    }

    // Set initial active mode
    setTrackModes(video, data.activeLang || "en");

    send("INJECT_SUCCESS", {
      enCount: enCount,
      trCount: trCount,
      activeLang: activeLangState
    });
  }

  // Handle messages from parent window
  window.addEventListener("message", function (event) {
    var d = event.data;
    if (!d || d.source !== "learnenglish-app") return;

    var video = document.querySelector("video");
    if (!video) return;

    if (d.type === "INJECT_SUBTITLES") {
      injectSubtitles(video, d);
    } else if (d.type === "SELECT_TRACK") {
      setTrackModes(video, d.lang || "en");
    } else if (d.type === "SEEK") {
      if (Number.isFinite(d.time)) {
        video.currentTime = d.time;
      }
    }
  });

  function attachVideo(video) {
    if (attached.has(video)) return;
    attached.add(video);

    video.addEventListener("timeupdate", function () {
      var now = Date.now();
      if (now - lastTimeSent > 220) {
        lastTimeSent = now;
        send("TIME_UPDATE", {
          currentTime: Number(video.currentTime) || 0,
          duration: Number(video.duration) || 0,
          paused: Boolean(video.paused)
        });
      }
    });

    video.addEventListener("play", function () {
      send("PLAYBACK_STATUS", { paused: false, currentTime: Number(video.currentTime) || 0 });
    });

    video.addEventListener("pause", function () {
      send("PLAYBACK_STATUS", { paused: true, currentTime: Number(video.currentTime) || 0 });
    });
  }

  function inspect() {
    var video = document.querySelector("video");
    if (!video) return;

    attachVideo(video);

    var now = Date.now();
    if (now - lastReady > 4000) {
      lastReady = now;
      send("READY", {
        currentTime: Number(video.currentTime) || 0,
        paused: Boolean(video.paused)
      });
    }

    var tracks = video.textTracks;
    if (!tracks) return;

    for (var i = 0; i < tracks.length; i++) {
      var track = tracks[i];
      if (!attached.has(track)) {
        attached.add(track);
        try {
          track.addEventListener("cuechange", function (event) {
            var cues = event.target && event.target.activeCues;
            if (cues) {
              for (var j = 0; j < cues.length; j++) emit(video, event.target, cues[j]);
            }
          });
        } catch (_) {}
      }
      var active = track.activeCues;
      if (active) {
        for (var k = 0; k < active.length; k++) emit(video, track, active[k]);
      }
    }
  }

  inspect();
  window.setInterval(inspect, 300);
})();
