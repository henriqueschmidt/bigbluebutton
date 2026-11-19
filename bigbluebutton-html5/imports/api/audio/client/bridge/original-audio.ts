import { Track, type Room } from 'livekit-client';
import logger from '/imports/startup/client/logger';
import MediaStreamUtils from '/imports/utils/media-stream-utils';
import { doGUM } from './service';
import recordAudioEvent from './recording-events';

type Capture = { room: Room; deviceId: string; track?: MediaStreamTrack };

// The recording room has a publish-only membership. Never fall back to the
// primary room, even when the recorder connection is interrupted.
class OriginalAudioPublisher {
  private readonly rooms = new Map<string, Room>();

  private meetingId?: string;

  private microphone?: MediaStreamTrack;

  private capture?: Capture;

  private retry?: ReturnType<typeof setTimeout>;

  private unavailable = false;

  private setUnavailable(unavailable: boolean): void {
    if (unavailable === this.unavailable) return;
    this.unavailable = unavailable;
    recordAudioEvent(unavailable ? 'OriginalAudioCaptureUnavailableEvent' : 'OriginalAudioCaptureAvailableEvent', '', this.meetingId);
  }

  setRoom(name: string, room?: Room, interrupted = false): void {
    if (room) this.rooms.set(name, room);
    else this.rooms.delete(name);
    if (interrupted && this.microphone && name === `audio-original:${this.meetingId}`) {
      this.setUnavailable(true);
    }
    this.sync();
  }

  setMicrophone(track?: MediaStreamTrack, meetingId?: string): void {
    if (!track || meetingId !== this.meetingId) this.setUnavailable(false);
    this.meetingId = meetingId;
    if (track !== this.microphone) {
      this.microphone?.removeEventListener('ended', this.sync);
      this.microphone?.removeEventListener('mute', this.sync);
      this.microphone?.removeEventListener('unmute', this.sync);
      this.microphone = track;
      track?.addEventListener('ended', this.sync);
      track?.addEventListener('mute', this.sync);
      track?.addEventListener('unmute', this.sync);
    }
    this.sync();
  }

  private sync = (): void => {
    clearTimeout(this.retry);
    const { meetingId, microphone, capture } = this;
    const room = meetingId ? this.rooms.get(`audio-original:${meetingId}`) : undefined;
    const microphoneIsActive = microphone?.readyState === 'live' && microphone.enabled && !microphone.muted;
    const deviceId = room && microphoneIsActive
      ? MediaStreamUtils.extractDeviceIdFromStream(new MediaStream([microphone]), 'audio') : null;
    if (capture && capture.room === room && capture.deviceId === deviceId) return;

    // Stop samples synchronously, including while publishTrack is pending.
    this.capture = undefined;
    if (capture?.track) {
      capture.track.enabled = false;
      capture.track.stop();
      capture.room.localParticipant.unpublishTrack(capture.track).catch(this.logFailure);
    }
    if (!room || !microphoneIsActive) return;
    if (!deviceId) {
      this.setUnavailable(true);
      return;
    }
    const next = { room, deviceId };
    this.capture = next;
    this.publish(next).catch((error) => {
      if (this.capture !== next) return;
      this.capture = undefined;
      this.setUnavailable(true);
      this.logFailure(error);
      this.retry = setTimeout(this.sync, 5_000);
    });
  };

  private async publish(capture: Capture): Promise<void> {
    const stream = await doGUM({ audio: { deviceId: { exact: capture.deviceId } } }, { originalAudio: true });
    const [track] = stream.getAudioTracks();
    if (!track) throw new Error('Original audio capture did not return a microphone track');
    if (this.capture !== capture) {
      track.stop();
      return;
    }
    this.capture.track = track;
    try {
      await capture.room.localParticipant.publishTrack(track, {
        name: 'audio-original',
        source: Track.Source.Microphone,
        red: false,
      });
      if (this.capture !== capture) {
        await capture.room.localParticipant.unpublishTrack(track);
        return;
      }
      this.setUnavailable(false);
      track.addEventListener('ended', () => {
        if (this.capture !== capture) return;
        this.capture = undefined;
        this.setUnavailable(true);
        capture.room.localParticipant.unpublishTrack(track).catch(this.logFailure);
        this.retry = setTimeout(this.sync, 5_000);
      }, { once: true });
    } catch (error) {
      track.stop();
      throw error;
    }
  }

  private logFailure = (error: Error): void => {
    logger.warn({ logCode: 'original_audio_publish', extraInfo: { error: error.message } },
      'Could not update the original audio recording track');
  };
}

export default new OriginalAudioPublisher();
