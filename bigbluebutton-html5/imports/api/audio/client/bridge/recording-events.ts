import { gql } from '@apollo/client';
import apolloContextHolder from '/imports/ui/core/graphql/apolloContextHolder/apolloContextHolder';
import logger from '/imports/startup/client/logger';

const RECORD_USER_AUDIO_EVENT = gql`
  mutation RecordUserAudioEvent($event: String!, $mode: String!, $room: String!) {
    userRecordAudioEvent(event: $event, mode: $mode, room: $room)
  }
`;

type AudioEvent = 'AudioProcessingModeChangedEvent' | 'OriginalAudioCaptureUnavailableEvent'
  | 'OriginalAudioCaptureAvailableEvent';

export default async function recordAudioEvent(event: AudioEvent, mode: string, room = ''): Promise<void> {
  try {
    await apolloContextHolder.getClient().mutate({
      mutation: RECORD_USER_AUDIO_EVENT,
      variables: { event, mode, room },
    });
  } catch (error) {
    logger.warn({
      logCode: 'audio_recording_event_failed',
      extraInfo: { event, error: (error as Error).message },
    }, 'Could not record audio event');
  }
}
