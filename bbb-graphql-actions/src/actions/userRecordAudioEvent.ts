import { RedisMessage } from '../types';
import { throwErrorIfInvalidInput } from '../imports/validation';

export default function buildRedisMessage(
    sessionVariables: Record<string, unknown>,
    input: Record<string, unknown>,
): RedisMessage {
    throwErrorIfInvalidInput(input, [
        {name: 'event', type: 'string', required: true},
        {name: 'mode', type: 'string', required: true},
        {name: 'room', type: 'string', required: true},
    ]);

    const eventName = 'RecordUserAudioEventReqMsg';
    const routing = {
        meetingId: sessionVariables['x-hasura-meetingid'] as string,
        userId: sessionVariables['x-hasura-userid'] as string,
    };

    return {
        eventName,
        routing,
        header: { name: eventName, ...routing },
        body: { event: input.event, mode: input.mode, room: input.room },
    };
}
