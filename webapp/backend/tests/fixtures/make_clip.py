"""Generate a ~3s stereo 44.1k WAV fixture for integration tests."""
import wave
from pathlib import Path

OUT = Path(__file__).with_name("clip.wav")


def main() -> None:
    sr, secs = 44100, 3
    with wave.open(str(OUT), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b"\x00\x00\x00\x00" * (sr * secs))
    print("wrote", OUT)


if __name__ == "__main__":
    main()