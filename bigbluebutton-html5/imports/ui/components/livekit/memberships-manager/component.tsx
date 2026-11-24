import React from 'react';
import useMeeting from '/imports/ui/core/hooks/useMeeting';
import { useUserLiveKitMemberships, type LiveKitRoomRow } from './hooks';
import PrimaryLiveKitRoom from '/imports/ui/components/livekit/primary-room/component';
import SecondaryLiveKitRoom from '/imports/ui/components/livekit/secondary-room/component';
import BreakoutListenRoom from '/imports/ui/components/livekit/breakout-listen-room/component';

import { isMobile } from '/imports/utils/deviceInfo';
import useDeduplicatedSubscription from '/imports/ui/core/hooks/useDeduplicatedSubscription';
import MeetingStaticDataStore from '/imports/ui/core/singletons/meetingStaticData';
import {
  GET_MEETING_RECORDING_DATA,
  type getMeetingRecordingData,
} from '/imports/ui/components/nav-bar/nav-bar-graphql/recording-indicator/queries';

const OriginalAudioRoom: React.FC<{ membership: LiveKitRoomRow }> = ({ membership }) => {
  const { data: recording } = useDeduplicatedSubscription<getMeetingRecordingData>(GET_MEETING_RECORDING_DATA);
  const { recordingPolicies } = MeetingStaticDataStore.getMeetingData();
  const capturing = recording?.meeting_recording[0]?.isRecording
    || recordingPolicies?.recordFullDurationMedia;
  return (
    <SecondaryLiveKitRoom membership={membership} recordingOnly recordingEnabled={!!capturing} />
  );
};

const renderMembership = (m: LiveKitRoomRow, primaryRoom?: string) => {
  const key = `${m.purpose}:${m.roomName}`;

  switch (m.purpose) {
    case 'audio-original':
      if (isMobile) return null;
      return m.roomName === `audio-original:${primaryRoom}`
        ? <OriginalAudioRoom key={key} membership={m} />
        : <SecondaryLiveKitRoom key={key} membership={m} recordingOnly />;
    case 'primary':
      return <PrimaryLiveKitRoom key={key} membership={m} />;
    case 'breakout-listen':
      return <BreakoutListenRoom key={key} membership={m} />;
    default:
      return <SecondaryLiveKitRoom key={key} membership={m} />;
  }
};

const LiveKitMembershipsManager: React.FC = () => {
  const { data: bridges } = useMeeting((m) => ({
    cameraBridge: m.cameraBridge,
    screenShareBridge: m.screenShareBridge,
    audioBridge: m.audioBridge,
  }));

  const shouldUseLiveKit = bridges?.cameraBridge === 'livekit'
    || bridges?.screenShareBridge === 'livekit'
    || bridges?.audioBridge === 'livekit';

  const memberships = useUserLiveKitMemberships();

  if (!shouldUseLiveKit) return null;

  const primaryRoom = memberships.find((m) => m.purpose === 'primary')?.roomName;

  return <>{memberships.map((m) => renderMembership(m, primaryRoom))}</>;
};

export default LiveKitMembershipsManager;
