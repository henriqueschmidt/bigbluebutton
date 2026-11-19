package org.bigbluebutton.core.record.events

class UserAudioRecordEvent(event: String, userId: String) extends AbstractVoiceRecordEvent {
  setEvent(event)
  eventMap.put("userId", userId)
}
