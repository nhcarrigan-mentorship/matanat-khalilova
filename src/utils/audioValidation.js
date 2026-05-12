export const checkIsSilent = async (blob) => {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const rawData = audioBuffer.getChannelData(0); // Get audio channel data

    let maxAmplitude = 0;
    for (let i = 0; i < rawData.length; i++) {
      if (Math.abs(rawData[i]) > maxAmplitude) {
        maxAmplitude = Math.abs(rawData[i]);
      }
    }

    // If the code works and the audio is loud → returns false (Not silent = Save it)
    // If the code works and the audio is quiet → returns true (Silent = Block it)

    // If the loudest point is less than 0.01 (1%), it's basically silent
    return maxAmplitude < 0.01;
  } catch (error) {
    console.error("Audio decoding failed:", error); // eslint-disable-line no-console
    return true; // Treat decoding errors as silent
  } finally {
    await audioContext.close();
  }
};

export const validateAudio = async (blob, duration) => {
  if (duration < 1500) {
    return {
      isValid: false,
      error: "Recording was too short, please speak the full phrase",
    };
  }
  const isSilent = await checkIsSilent(blob);
  if (isSilent) {
    return {
      isValid: false,
      error: "We didn't detect any speech, please try again",
    };
  }

  return { isValid: true, error: null };
};
