import { validateAudio, checkIsSilent } from "../audioValidation";

// Fix for missing Blob.arrayBuffer

if (typeof Blob !== "undefined" && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function () {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsArrayBuffer(this);
    });
  };
}

// Fix for missing AudioContext

window.AudioContext =
  window.AudioContext ||
  class {
    decodeAudioData() {
      return Promise.resolve({
        getChannelData: () => new Float32Array([0.1, 0.2, 0.1]),
        duration: 2.0,
      });
    }
    close() {
      return Promise.resolve();
    }
  };

describe("Audio Validation Tests", () => {
  test("returns false for buffers under 1500ms", async () => {
    const mockBlob = new Blob(["short"], { type: "audio/wav" });
    const result = await validateAudio(mockBlob, 1200);
    expect(result.isValid).toBe(false);
    expect(result.error).toBe(
      "Recording was too short, please speak the full phrase",
    );
  });

  test("returns true for buffers over 1500ms", async () => {
    const BlockBlob = new Blob(["valid-data"], { type: "audio/wav" });
    const result = await validateAudio(BlockBlob, 2000);
    expect(result.isValid).toBe(true);
    expect(result.error).not.toBe(
      "Recording was too short, please speak the full phrase",
    );
  });

  test("silence utility returns a boolean status", async () => {
    const mockBlob = new Blob(["data"], { type: "audio/wav" });
    const isSilent = await checkIsSilent(mockBlob);
    expect(typeof isSilent).toBe("boolean");
  });
});
