# Audio fixture

`segment-tone.mp3` is an original, generated two-second 440 Hz tone: mono,
24 kHz, 128 kbps MP3. It contains no speech or third-party recording.
The browser playback regression sends it as successive MiniMax segments.

Reproduce with FFmpeg (not required to run the tests):

```sh
ffmpeg -f lavfi -i "sine=frequency=440:sample_rate=24000:duration=2" -ac 1 -c:a libmp3lame -b:a 128k -write_xing 0 -id3v2_version 0 segment-tone.mp3
```

Omitting the single-file duration header allows the same fixture to exercise
concatenated MP3 playback across completed segments.
