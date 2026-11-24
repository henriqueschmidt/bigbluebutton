import React, {
  useEffect, useRef, useState, useMemo, useCallback,
} from 'react';
import {
  ConnectionState, LogLevel, RoomEvent, Room,
} from 'livekit-client';
import { RoomAudioRenderer } from '@livekit/components-react';
import originalAudio from '/imports/api/audio/client/bridge/original-audio';
import Auth from '/imports/ui/services/auth';
import useMeetingSettings from '/imports/ui/core/local-states/useMeetingSettings';
import {
  liveKitRoomRegistry,
  resolveRoomOptions,
  type MembershipKey,
} from '/imports/ui/services/livekit';
import BaseLiveKitRoom from '/imports/ui/components/livekit/base-room/component';
import type { LiveKitRoomRow } from '/imports/ui/components/livekit/memberships-manager/hooks';
import AudioManager from '/imports/ui/services/audio-manager';
import { useIsUsingLiveKitAudio } from '/imports/ui/core/hooks/livekit/useShouldUseLiveKitAudioState';
import { useSpeakerLevel } from '/imports/ui/components/audio/audio-graphql/audio-controls/input-stream-live-selector/service';

// AudioManager.bridge can be any of the audio bridges (SFU, SIP, LiveKit).
// attachSecondaryRoom / detachSecondaryRoom are implemented only by the
// LiveKit bridge; this structural type narrows just those methods so the
// runtime presence-check below type-checks cleanly without depending on
// the concrete bridge class (which is .js). We can remove this later
// once bridges are cleaned up and/or fully typed.
type SecondaryRoomCapableBridge = {
  attachSecondaryRoom?: (room: Room, membershipKey: MembershipKey) => Promise<void>;
  detachSecondaryRoom?: () => Promise<void>;
};

interface SecondaryLiveKitRoomProps {
  membership: LiveKitRoomRow;
  membershipKey?: MembershipKey;
  recordingOnly?: boolean;
  recordingEnabled?: boolean;
  // When true, attaches the LK audio bridge to this Room.
  // Required for purposes that expect the user to publish audio into the
  // secondary room with controls in the main room.
  // Off by default for passive scenarios (e.g.: recvonly)
  attachToAudioBridge?: boolean;
  // Fired when BaseLiveKitRoom exhausts its reconnect attempts.
  onReconnectExhausted?: () => void;
  // Fired on a disconnect LiveKit will not retry (no reconnect cycle runs, so
  // onReconnectExhausted never fires for it).
  onTerminalDisconnect?: () => void;
}

const SECONDARY_RECONNECT_ATTEMPTS = 5;

const SecondaryLiveKitRoom: React.FC<SecondaryLiveKitRoomProps> = ({
  membership,
  membershipKey,
  attachToAudioBridge = false,
  recordingOnly = false,
  recordingEnabled = true,
  onReconnectExhausted,
  onTerminalDisconnect,
}) => {
  const [meetingSettings] = useMeetingSettings();
  const speakerLevel = useSpeakerLevel();
  const url = meetingSettings.public.media?.livekit?.url ?? `wss://${window.location.hostname}/livekit`;
  const logLevel = meetingSettings.public.media?.livekit?.logLevel ?? LogLevel.warn;
  const sdkLogBridge = meetingSettings.public.media?.livekit?.sdkLogBridge ?? true;
  const configuredRoomOptions = meetingSettings.public.media?.livekit?.roomOptions;
  // A fresh object per render would re-run the room-options effect downstream.
  const roomOptions = useMemo(() => resolveRoomOptions(configuredRoomOptions), [configuredRoomOptions]);
  const reconnectOnFatalFailures = meetingSettings.public.media?.livekit?.reconnectOnFatalFailures ?? true;

  const key: MembershipKey = membershipKey ?? `${membership.purpose}:${membership.roomName}`;

  const [room] = useState(() => (
    recordingOnly ? new Room(roomOptions) : liveKitRoomRegistry.acquire(key, roomOptions)
  ));
  const bridgeReady = useIsUsingLiveKitAudio();
  const attachedRef = useRef(false);

  useEffect(() => {
    if (!recordingOnly) return undefined;
    const name = membership.roomName;
    const update = () => {
      const connected = recordingEnabled && room.state === ConnectionState.Connected;
      originalAudio.setRoom(name, connected ? room : undefined);
    };
    room.on(RoomEvent.ConnectionStateChanged, update);
    update();
    return () => {
      room.off(RoomEvent.ConnectionStateChanged, update);
      originalAudio.setRoom(name);
    };
  }, [room, recordingOnly, recordingEnabled, membership.roomName]);

  const reportRecordingRoomFailure = useCallback(() => {
    if (recordingEnabled) originalAudio.setRoom(membership.roomName);
  }, [membership.roomName, recordingEnabled]);

  // Bridge attachment
  useEffect(() => {
    if (!attachToAudioBridge || !bridgeReady || attachedRef.current) return;

    const bridge = AudioManager?.bridge as SecondaryRoomCapableBridge | undefined;

    if (bridge?.attachSecondaryRoom) {
      attachedRef.current = true;
      bridge.attachSecondaryRoom(room, key);
    }
  }, [room, key, attachToAudioBridge, bridgeReady]);

  // Teardown/detachment: hand the mic back to the primary (detachSecondaryRoom)
  // BEFORE releasing this room, so the room registry's disconnect never precedes
  // the bridge's room switch-back (which could orphan mics and leave them muted in
  // the primary room).
  useEffect(() => {
    return () => {
      const bridge = AudioManager?.bridge as SecondaryRoomCapableBridge | undefined;

      if (attachedRef.current && bridge?.detachSecondaryRoom) {
        attachedRef.current = false;
        bridge.detachSecondaryRoom();
      }

      if (!recordingOnly) liveKitRoomRegistry.release(key);
    };
  }, [room, key, recordingOnly]);

  const { sessionToken } = Auth;

  if (!membership.token || typeof sessionToken !== 'string') return null;

  return (
    <BaseLiveKitRoom
      membershipKey={key}
      room={room}
      url={url}
      token={membership.token}
      bbbSessionToken={sessionToken}
      roomOptions={roomOptions}
      logLevel={logLevel}
      sdkLogBridge={sdkLogBridge}
      audio={false}
      video={false}
      withAutoSubscribe={!recordingOnly}
      reconnectOnFatalFailures={reconnectOnFatalFailures}
      logPrefix={`livekit_secondary_${membership.roomName}`}
      maxConnAttempts={SECONDARY_RECONNECT_ATTEMPTS}
      onReconnectExhausted={recordingOnly ? reportRecordingRoomFailure : onReconnectExhausted}
      onTerminalDisconnect={recordingOnly ? reportRecordingRoomFailure : onTerminalDisconnect}
    >
      {!recordingOnly && <RoomAudioRenderer volume={speakerLevel} />}
    </BaseLiveKitRoom>
  );
};

export default SecondaryLiveKitRoom;
