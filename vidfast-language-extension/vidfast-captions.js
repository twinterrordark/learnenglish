(function () {
  "use strict";
  if (!/^(vidfast\.pro|vidfast\.vc)$/.test(location.hostname)) return;

  var attachedVideos = new WeakSet();
  var readyVideos = new WeakSet();
  var lastTimeSent = 0;
  var activeLangState = "en"; // "en", "tr", "off"
  var enCues = [];
  var trCues = [];
  var syncOffset = 0.0;
  var overlayEl = null;

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

    // Check accessible iframes
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

  function disableAllNativeTracks(video) {
    if (!video) return;
    try {
      if (video.textTracks) {
        for (var i = 0; i < video.textTracks.length; i++) {
          video.textTracks[i].mode = "disabled";
        }
      }
      var domTracks = video.querySelectorAll("track");
      for (var j = 0; j < domTracks.length; j++) {
        domTracks[j].remove();
      }
    } catch (_) {}
  }

  function getOrCreateOverlay(video) {
    if (overlayEl && overlayEl.isConnected) return overlayEl;
    overlayEl = document.getElementById("vidfast-learnenglish-subtitle-overlay");
    if (overlayEl) return overlayEl;

    overlayEl = document.createElement("div");
    overlayEl.id = "vidfast-learnenglish-subtitle-overlay";
    overlayEl.style.cssText = [
      "position: absolute",
      "bottom: 50px",
      "left: 50%",
      "transform: translateX(-50%)",
      "z-index: 2147483647",
      "max-width: 86%",
      "text-align: center",
      "pointer-events: none",
      "user-select: none",
      "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      "font-size: 22px",
      "font-weight: 700",
      "line-height: 1.35",
      "color: #ffffff",
      "text-shadow: 0 0 3px #000, 0 1px 2px #000, 0 2px 4px #000, 0 0 8px rgba(0,0,0,0.9)",
      "background: rgba(0, 0, 0, 0.72)",
      "padding: 5px 14px",
      "border-radius: 6px",
      "display: none",
      "box-sizing: border-box"
    ].join("; ");

    var targetContainer = (video && video.parentElement) || document.body;
    try {
      var pos = window.getComputedStyle(targetContainer).position;
      if (pos === "static") targetContainer.style.position = "relative";
    } catch (_) {}

    targetContainer.appendChild(overlayEl);
    return overlayEl;
  }

  function hideOverlay() {
    if (overlayEl) {
      overlayEl.textContent = "";
      overlayEl.style.display = "none";
    }
  }

  function showOverlay(text, video) {
    var clean = String(text || "").trim();
    if (!clean || activeLangState === "off") {
      hideOverlay();
      return;
    }
    var ov = getOrCreateOverlay(video || findVideo());
    if (ov) {
      ov.textContent = clean;
      ov.style.display = "block";
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

    // Forward down to all child iframes
    for (var fi = 0; fi < window.frames.length; fi++) {
      try {
        window.frames[fi].postMessage(d, "*");
      } catch (_) {}
    }

    var video = findVideo();
    disableAllNativeTracks(video);

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

      send("INJECT_SUCCESS", {
        enCount: enCues.length,
        trCount: trCues.length,
        activeLang: activeLangState
      });
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

    disableAllNativeTracks(video);
    getOrCreateOverlay(video);

    video.addEventListener("timeupdate", function () {
      var t = Number(video.currentTime) || 0;
      var now = Date.now();

      // Update overlay dynamically on video time
      updateOverlayForTime(t, video);

      // Report time to parent
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
  }

  function inspect() {
    var video = findVideo();
    if (!video) return;

    attachVideo(video);
    disableAllNativeTracks(video);

    if (!readyVideos.has(video)) {
      readyVideos.add(video);
      send("READY", {
        currentTime: Number(video.currentTime) || 0,
        paused: Boolean(video.paused)
      });
    }
  }

  inspect();
  window.setInterval(inspect, 350);
})();
