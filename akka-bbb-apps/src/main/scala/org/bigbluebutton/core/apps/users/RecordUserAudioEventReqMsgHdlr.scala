package org.bigbluebutton.core.apps.users

import org.bigbluebutton.common2.msgs._
import org.bigbluebutton.core.domain.MeetingState2x
import org.bigbluebutton.core.models.{ LiveKitMemberships, Users2x }
import org.bigbluebutton.core.running.{ LiveMeeting, OutMsgRouter }

trait RecordUserAudioEventReqMsgHdlr {
  this: UsersApp =>

  val liveMeeting: LiveMeeting
  val outGW: OutMsgRouter

  private val audioModes = Set("standard", "original", "advanced", "voiceIsolation", "browserFallback")

  def handleRecordUserAudioEventReqMsg(msg: RecordUserAudioEventReqMsg, state: MeetingState2x): Unit = {
    val policy = liveMeeting.props.recordProp
    val room = msg.body.room
    val userId = msg.header.userId
    val ownRoom = room == liveMeeting.props.meetingProp.intId
    val recorded = if (ownRoom) policy.record else {
      state.breakout.exists(breakouts => breakouts.record && breakouts.find(room).isDefined) &&
        LiveKitMemberships.findByUserAndRoom(liveMeeting.liveKitMemberships, userId, room)
        .exists(membership => membership.purpose == "breakout-listen" && membership.token.isDefined)
    }
    val valid = msg.body.event match {
      case "AudioProcessingModeChangedEvent" => audioModes.contains(msg.body.mode)
      case "OriginalAudioCaptureUnavailableEvent" | "OriginalAudioCaptureAvailableEvent" =>
        policy.recordOriginalAudio && msg.body.mode.isEmpty
      case _ => false
    }

    if (recorded && valid && Users2x.findWithIntId(liveMeeting.users2x, userId).isDefined) {
      val header = msg.header.copy(meetingId = room)
      val envelope = BbbCoreEnvelope(header.name, Routing.addMsgToClientRouting(MessageTypes.DIRECT, room, userId))
      outGW.outGW.record(BbbCommonEnvCoreMsg(envelope, msg.copy(header = header)))
    }
  }
}
