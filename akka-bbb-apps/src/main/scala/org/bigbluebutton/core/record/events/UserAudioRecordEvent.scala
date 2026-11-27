package org.bigbluebutton.core.record.events

class UserAudioRecordEvent(event: String, userId: String, mode: String) extends AbstractVoiceRecordEvent {
  setEvent(event)
  eventMap.put("userId", userId)
  if (mode.nonEmpty) eventMap.put("mode", mode)
}
