package org.bigbluebutton.core.apps.users

import org.bigbluebutton.common2.msgs._
import org.bigbluebutton.core.domain.MeetingState2x
import org.bigbluebutton.core.models.{ LiveKitMemberships, Users2x }
import org.bigbluebutton.core.running.{ LiveMeeting, OutMsgRouter }

import scala.collection.mutable
import scala.concurrent.duration._

trait RecordUserAudioEventReqMsgHdlr {
  this: UsersApp =>

  val liveMeeting: LiveMeeting
  val outGW: OutMsgRouter

  private val audioModes = Set("standard", "original", "advanced", "voiceIsolation", "browserFallback")
  private val audioEventRateLimiter = new AudioEventRateLimiter

  def handleRecordUserAudioEventReqMsg(msg: RecordUserAudioEventReqMsg, state: MeetingState2x): Unit = {
    val policy = liveMeeting.props.recordProp
    val room = msg.body.room
    val userId = msg.header.userId
    val ownRoom = room == liveMeeting.props.meetingProp.intId
    val recorded = if (ownRoom) policy.record else {
      state.breakout.exists(breakouts => breakouts.record && breakouts.find(room).isDefined)
    }
    def authorized = ownRoom ||
      LiveKitMemberships.findByUserAndRoom(liveMeeting.liveKitMemberships, userId, room)
        .exists(membership => membership.purpose == "breakout-listen" && membership.token.isDefined)

    val rejection = if (msg.body.event != "AudioProcessingModeChangedEvent") Some("unsupported event")
    else if (!audioModes.contains(msg.body.mode)) Some("unsupported mode")
    else if (!recorded) Some("target meeting is not recordable")
    else if (!authorized) Some("missing authorized breakout membership")
    else if (Users2x.findWithIntId(liveMeeting.users2x, userId).isEmpty) Some("unknown participant")
    else if (!audioEventRateLimiter.allow(userId, System.nanoTime())) Some("participant rate limit exceeded")
    else None

    rejection match {
      case Some(reason) =>
        log.debug("Dropping audio processing mode event for user {} in meeting {}: {}", userId, room, reason)
      case None =>
        log.debug("Recording audio processing mode {} for user {} in meeting {}", msg.body.mode, userId, room)
        val header = msg.header.copy(meetingId = room)
        val envelope = BbbCoreEnvelope(header.name, Routing.addMsgToClientRouting(MessageTypes.DIRECT, room, userId))
        outGW.outGW.record(BbbCommonEnvCoreMsg(envelope, msg.copy(header = header)))
    }
  }
}

private[users] final class AudioEventRateLimiter {
  private val maxEvents = 8
  private val window = 2.seconds.toNanos
  // The meeting actor owns this state. Entries are ordered by their latest accepted event.
  private val userTimestamps = mutable.LinkedHashMap.empty[String, Vector[Long]]

  def allow(userId: String, now: Long): Boolean = {
    val expiredUsers = userTimestamps.iterator
      .takeWhile { case (_, timestamps) => now - timestamps.last >= window }
      .map(_._1).toList
    expiredUsers.foreach(userTimestamps.remove)

    val recent = userTimestamps.getOrElse(userId, Vector.empty)
      .dropWhile(timestamp => now - timestamp >= window)
    if (recent.size >= maxEvents) {
      false
    } else {
      userTimestamps.remove(userId)
      userTimestamps.update(userId, recent :+ now)
      true
    }
  }
}
