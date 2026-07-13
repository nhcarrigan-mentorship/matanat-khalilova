import React, { useEffect, useRef } from "react";
import WaveSurfer from "wavesurfer.js";

/*eslint-disable react/prop-types */

/**
 * Waveform preview for a recorded audio blob URL.
 *
 * Declared at module scope on purpose. Previously this lived inside the Train
 * component body, so React saw a brand new component type on every render of
 * Train and tore the whole WaveSurfer instance down and rebuilt it.
 */
const WaveformPlayer = ({ url, isPlaying, onFinish }) => {
  const containerRef = useRef(null);
  const waveSurferRef = useRef(null);

  // onFinish is kept in a ref so that callers passing an inline arrow function
  // (a new identity on every render) do not re-trigger the setup effect below
  // and rebuild the waveform. The effect depends only on the url.
  const onFinishRef = useRef(onFinish);
  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    if (!containerRef.current) return;
    // Create the waveform visualizer
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "#babdc1", // Light grey for the background waves
      progressColor: "#8b5cf6", // Purple for the played part
      cursorColor: "transparent",
      barWidth: 3, // Make it look like bars
      barRadius: 3,
      responsive: true,
      height: 40,
      normalize: true, // Make quiet recordings look better
    });

    waveSurferRef.current = ws;
    ws.load(url).catch((err) => {
      if (err.name !== "AbortError") {
        console.error("WaveSurfer error:", err); // eslint-disable-line no-console
      }
    });

    ws.on("finish", () => {
      onFinishRef.current?.();
    });

    return () => {
      ws.un("finish"); // Stop listening (remove the ear)
      ws.destroy(); // Delete the whole player
    };
  }, [url]);

  useEffect(() => {
    if (waveSurferRef.current) {
      if (isPlaying) {
        waveSurferRef.current.play();
      } else {
        waveSurferRef.current.pause();
      }
    }
  }, [isPlaying]);

  return (
    <div ref={containerRef} style={{ width: "100%", cursor: "pointer" }} />
  );
};

export default WaveformPlayer;
