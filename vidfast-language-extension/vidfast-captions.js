(function () {
  "use strict";
  if (!/^(vidfast\.pro|vidfast\.vc)$/.test(location.hostname)) return;

  var attachedVideos = new WeakSet();
  var lastTimeSent = 0;
  var activeLangState = "en"; // "en", "tr", "off"
  var enCues = [];
  var trCues = [];
  var syncOffset = 0.0;
  var overlayEl = null;
  var overlayTxtEl = null;

  function send(type, data) {
    try {
      window.top.postMessage(Object.assign({ source: "learnenglish-vidfast-bridge", type: type }, data || {}), "*");
    } catch (_) {}
  }

  function findVideo() {
    var v = document.querySelector("video");
    if (v) return v;
    var allV = document.querySelectorAll("video");
    if (allV && allV.length) return allV[0];

    var iframes = document.querySelectorAll("iframe");
    for (var i = 0; i < iframes.length; i++) {
      try {
        var doc = iframes[i].contentDocument || (iframes[i].contentWindow && iframes[i].contentWindow.document);
        if (doc) {
          var subV = doc.querySelector("video");
          if (subV) return subV;
        }
      } catch (_) {}
    }
    return null;
  }

  function getOrCreateOverlay(video) {
    if (overlayEl && overlayEl.isConnected) return overlayEl;
    overlayEl = document.getElementById("learnenglish-inplayer-overlay");
    if (overlayEl) {
      overlayTxtEl = document.getElementById("learnenglish-inplayer-text");
      return overlayEl;
    }

    overlayEl = document.createElement("div");
    overlayEl.id = "learnenglish-inplayer-overlay";
    overlayEl.style.cssText = "position:absolute;bottom:48px;left:50%;transform:translateX(-50%);max-width:88%;text-align:center;pointer-events:none;z-index:2147483647;display:none;transition:opacity .12s;";

    overlayTxtEl = document.createElement("div");
    overlayTxtEl.id = "learnenglish-inplayer-text";
    overlayTxtEl.style.cssText = "display:inline-block;background:rgba(0,0,0,0.78);color:#ffffff;font-size:22px;font-weight:700;line-height:1.35;padding:5px 15px;border-radius:7px;text-shadow:0 0 3px #000, 0 1px 2px #000, 0 2px 4px #000;box-shadow:0 3px 10px rgba(0,0,0,0.5);font-family:system-ui,-apple-system,sans-serif;";
    overlayEl.appendChild(overlayTxtEl);

    var parent = (video && video.parentElement) || document.body;
    try {
      if (window.getComputedStyle(parent).position === "static") {
        parent.style.position = "relative";
      }
      parent.appendChild(overlayEl);
    } catch (_) {
      document.body.appendChild(overlayEl);
    }
    return overlayEl;
  }

  function hideOverlay() {
    if (overlayEl) {
      overlayEl.style.display = "none";
      if (overlayTxtEl) overlayTxtEl.textContent = "";
    }
  }

  function showOverlay(text, video) {
    var clean = String(text || "").trim();
    if (!clean || activeLangState === "off") {
      hideOverlay();
      return;
    }
    getOrCreateOverlay(video || findVideo());
    if (overlayTxtEl && overlayEl) {
      overlayTxtEl.textContent = clean;
      overlayEl.style.display = "block";
    }
  }

  function findCueAtTime(cues, t) {
    if (!cues || !cues.length) return null;
    for (var i = 0; i < cues.length; i++) {
      if (t >= cues[i].start && t <= cues[i].end) return cues[i];
    }
    return null;
  }

  function updateOverlayForTime(t, video) {
    if (activeLangState === "off") {
      hideOverlay();
      return;
    }
    var eff = t + syncOffset;
    var activeCues = (activeLangState === "tr") ? trCues : enCues;
    var cue = findCueAtTime(activeCues, eff);
    if (cue && cue.text) {
      showOverlay(cue.text, video);
    } else {
      hideOverlay();
    }
  }

  // Handle messages from parent application
  window.addEventListener("message", function (event) {
    var d = event.data;
    if (!d || d.source !== "learnenglish-app") return;

    for (var fi = 0; fi < window.frames.length; fi++) {
      try { window.frames[fi].postMessage(d, "*"); } catch (_) {}
    }

    var video = findVideo();

    if (d.type === "SELECT_TRACK") {
      activeLangState = d.lang || "en";
      if (typeof d.syncOffset === "number") syncOffset = d.syncOffset;
      if (activeLangState === "off") {
        hideOverlay();
      } else if (video) {
        updateOverlayForTime(Number(video.currentTime) || 0, video);
      }
      return;
    }

    if (d.type === "SET_SYNC_OFFSET") {
      syncOffset = Number(d.syncOffset) || 0.0;
      if (video && activeLangState !== "off") {
        updateOverlayForTime(Number(video.currentTime) || 0, video);
      }
      return;
    }

    if (d.type === "SET_OVERLAY_TEXT") {
      if (d.activeLang) activeLangState = d.activeLang;
      if (activeLangState === "off") {
        hideOverlay();
      } else if (d.text) {
        showOverlay(d.text, video);
      } else {
        hideOverlay();
      }
      return;
    }

    if (d.type === "INJECT_SUBTITLES") {
      enCues = Array.isArray(d.enCues) ? d.enCues : [];
      trCues = Array.isArray(d.trCues) ? d.trCues : [];
      activeLangState = d.activeLang || "en";
      if (typeof d.syncOffset === "number") syncOffset = d.syncOffset;

      if (video) {
        updateOverlayForTime(Number(video.currentTime) || 0, video);
      }
      return;
    }

    if (d.type === "SEEK") {
      var targetTime = Number(d.time);
      if (Number.isFinite(targetTime)) {
        if (video) {
          video.currentTime = targetTime;
          try { video.dispatchEvent(new Event("seeked")); } catch (_) {}
          try { video.dispatchEvent(new Event("timeupdate")); } catch (_) {}
          updateOverlayForTime(targetTime, video);
        }
        try {
          if (window.player && typeof window.player.seek === "function") window.player.seek(targetTime);
          if (window.art && typeof window.art.seek === "function") window.art.seek = targetTime;
          if (window.dp && typeof window.dp.seek === "function") window.dp.seek(targetTime);
        } catch (_) {}
      }
      return;
    }
  });

  function attachVideo(video) {
    if (attachedVideos.has(video)) return;
    attachedVideos.add(video);

    getOrCreateOverlay(video);

    video.addEventListener("timeupdate", function () {
      var t = Number(video.currentTime) || 0;
      var now = Date.now();

      updateOverlayForTime(t, video);

      if (now - lastTimeSent > 200) {
        lastTimeSent = now;
        send("TIME_UPDATE", {
          currentTime: t,
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

    send("READY", {
      currentTime: Number(video.currentTime) || 0,
      paused: Boolean(video.paused)
    });
  }

  function inspect() {
    var video = findVideo();
    if (!video) return;
    attachVideo(video);
  }

  inspect();
  window.setInterval(inspect, 400);
})();
