import type { RoomEvent } from "@/types";
import { useLanguage } from "@/composables/useLanguage";

export function useRoomEventText() {
  const { t } = useLanguage();

  function eventTypeLabel(type: RoomEvent["type"]): string {
    const keyMap: Record<RoomEvent["type"], string> = {
      room_created: "eventRoomCreated",
      player_joined: "eventPlayerJoined",
      player_left: "eventPlayerLeft",
      player_kicked: "eventPlayerKicked",
      room_dissolved: "eventRoomDissolved",
      game_reset: "eventGameReset",
      player_sat: "eventPlayerSat",
      game_started: "eventGameStarted",
      bid_submitted: "eventBidSubmitted",
      card_submitted: "eventCardSubmitted",
      game_finished: "eventGameFinished",
    };

    return t(keyMap[type]);
  }

  function phaseLabel(phase: RoomEvent["room"]["gameState"]["phase"]): string {
    const keyMap = {
      waiting: "phaseWaiting",
      bidding: "phaseBidding",
      playing: "phasePlaying",
      finished: "phaseFinished",
    } as const;

    return t(keyMap[phase]);
  }

  function formatRoomEvent(event: RoomEvent): string {
    const extras: string[] = [];
    if (event.meta?.actorPlayerId) {
      extras.push(`${t("eventActor")} ${event.meta.actorPlayerId}`);
    }
    if (event.meta?.targetPlayerId) {
      extras.push(`${t("eventTarget")} ${event.meta.targetPlayerId}`);
    }

    return [
      `${t("eventSequence")} ${event.sequence}`,
      eventTypeLabel(event.type),
      `${t("eventPhase")} ${phaseLabel(event.room.gameState.phase)}`,
      ...extras,
    ].join(" · ");
  }

  return {
    formatRoomEvent,
    phaseLabel,
    eventTypeLabel,
  };
}