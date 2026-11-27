import { gql } from '@apollo/client';
import apolloContextHolder from '/imports/ui/core/graphql/apolloContextHolder/apolloContextHolder';
import logger from '/imports/startup/client/logger';

const RECORD_USER_AUDIO_EVENT = gql`
  mutation RecordUserAudioEvent($event: String!, $mode: String!, $room: String!) {
    userRecordAudioEvent(event: $event, mode: $mode, room: $room)
  }
`;

type AudioEvent = 'AudioProcessingModeChangedEvent';

export default async function recordAudioEvent(event: AudioEvent, mode: string, room: string): Promise<boolean> {
  try {
    const { data } = await apolloContextHolder.getClient().mutate<{ userRecordAudioEvent: boolean }>({
      mutation: RECORD_USER_AUDIO_EVENT,
      variables: { event, mode, room },
    });
    if (data?.userRecordAudioEvent !== true) throw new Error('Audio event submission was not acknowledged');
    return true;
  } catch (error) {
    logger.warn({
      logCode: 'audio_recording_event_failed',
      extraInfo: { event, error: (error as Error).message },
    }, 'Could not record audio event');
    return false;
  }
}
