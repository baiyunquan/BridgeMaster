import { ref } from "vue";

export type Language = "zh" | "en";

type Dictionary = Record<string, { zh: string; en: string }>;

const STORAGE_KEY = "bridge-language";

const initial = (localStorage.getItem(STORAGE_KEY) as Language | null) ?? "zh";
export const currentLanguage = ref<Language>(initial === "en" ? "en" : "zh");

const dictionary: Dictionary = {
  language: { zh: "语言", en: "Language" },
  chinese: { zh: "中文", en: "Chinese" },
  english: { zh: "English", en: "English" },
  lobbyEnter: { zh: "进入游戏", en: "Enter Game" },
  refreshLobby: { zh: "刷新大厅", en: "Refresh" },
  displayName: { zh: "显示名", en: "Display Name" },
  editName: { zh: "修改", en: "Edit" },
  yourId: { zh: "你的 ID", en: "Your ID" },
  roomName: { zh: "房间名称", en: "Room Name" },
  createAndEnter: { zh: "创建房间并进入", en: "Create & Enter" },
  inviteCode: { zh: "邀请码", en: "Invite Code" },
  joinByCode: { zh: "通过邀请码加入", en: "Join by Code" },
  roomList: { zh: "大厅房间", en: "Lobby Rooms" },
  playerLinks: { zh: "玩家独立页面", en: "Player Links" },
  backToLobby: { zh: "返回大厅", en: "Back to Lobby" },
  leaveRoom: { zh: "退出房间", en: "Leave Room" },
  reconnect: { zh: "重连实时流", en: "Reconnect" },
  stageSetupBid: { zh: "页面: 选座 / 叫牌", en: "Page: Setup / Bidding" },
  stagePlay: { zh: "页面: 打牌", en: "Page: Playing" },
  stageResult: { zh: "页面: 结算", en: "Page: Result" },
  roomMembers: { zh: "房间名单", en: "Room Members" },
  notSeated: { zh: "未坐下", en: "Not Seated" },
  yourConsole: { zh: "你的控制台", en: "Your Console" },
  waitingSeat: { zh: "等待选座", en: "Waiting Seat" },
  seated: { zh: "已坐下", en: "Seated" },
  bidStage: { zh: "叫牌阶段", en: "Bidding Stage" },
  yourTurnBid: { zh: "轮到你叫牌", en: "Your turn to bid" },
  waitingOthers: { zh: "等待其他玩家", en: "Waiting others" },
  pass: { zh: "不叫", en: "Pass" },
  double: { zh: "加倍", en: "Double" },
  redouble: { zh: "再加倍", en: "Redouble" },
  bidHistory: { zh: "叫牌记录", en: "Bidding History" },
  seatHint: { zh: "点击座位图中的空位直接坐下。四个方位都坐满后会自动发牌并进入叫牌。", en: "Click an empty seat on the map to sit directly. The game starts automatically after all four seats are occupied." },
  setupStage: { zh: "选座 / 叫牌阶段", en: "Setup / Bidding Stage" },
  playStage: { zh: "打牌阶段", en: "Playing Stage" },
  resultStage: { zh: "结算阶段", en: "Result Stage" },
  contractCurrent: { zh: "当前定约", en: "Contract" },
  seatMine: { zh: "你的座位", en: "Your Seat" },
  loading: { zh: "加载中", en: "Loading" },
  roomEvents: { zh: "房间事件", en: "Room Events" },
  handCards: { zh: "你的手牌", en: "Your Hand" },
  biddingPanel: { zh: "叫牌控制", en: "Bidding Controls" },
  playPanel: { zh: "打牌阶段", en: "Play Controls" },
  you: { zh: "你", en: "You" },
  host: { zh: "房主", en: "Host" },
  removePlayer: { zh: "移除", en: "Remove" },
  dissolveRoom: { zh: "解散房间", en: "Dissolve Room" },
  removePlayerConfirm: { zh: "确认移除该玩家吗？", en: "Remove this player from the room?" },
  dissolveRoomConfirm: { zh: "确认解散整个房间吗？", en: "Dissolve this room for everyone?" },
  tableMode: { zh: "牌桌模式", en: "Table Mode" },
  tableClassic: { zh: "经典牌桌", en: "Classic Table" },
  table3d: { zh: "立体牌桌", en: "3D Table" },
  dummyHand: { zh: "明牌", en: "Dummy" },
  hiddenHand: { zh: "暗手", en: "Hidden Hand" },
  currentTrick: { zh: "当前一墩", en: "Current Trick" },
  noCurrentTrick: { zh: "等待首张出牌", en: "Waiting For Opening Lead" },
  eventActor: { zh: "执行者", en: "Actor" },
  eventTarget: { zh: "目标", en: "Target" },
  eventSequence: { zh: "事件", en: "Event" },
  eventPhase: { zh: "阶段", en: "Phase" },
  phaseWaiting: { zh: "等待", en: "Waiting" },
  phaseBidding: { zh: "叫牌", en: "Bidding" },
  phasePlaying: { zh: "打牌", en: "Playing" },
  phaseFinished: { zh: "结算", en: "Finished" },
  eventRoomCreated: { zh: "房间已创建", en: "Room Created" },
  eventPlayerJoined: { zh: "玩家已加入", en: "Player Joined" },
  eventPlayerLeft: { zh: "玩家已离开", en: "Player Left" },
  eventPlayerKicked: { zh: "玩家已被移除", en: "Player Removed" },
  eventRoomDissolved: { zh: "房间已解散", en: "Room Dissolved" },
  eventGameReset: { zh: "牌局已重置", en: "Game Reset" },
  eventPlayerSat: { zh: "座位已更新", en: "Seat Updated" },
  eventGameStarted: { zh: "牌局已开始", en: "Game Started" },
  eventBidSubmitted: { zh: "叫牌已提交", en: "Bid Submitted" },
  eventCardSubmitted: { zh: "出牌已提交", en: "Card Submitted" },
  eventGameFinished: { zh: "牌局已结束", en: "Game Finished" },
};

export function setLanguage(language: Language) {
  currentLanguage.value = language;
  localStorage.setItem(STORAGE_KEY, language);
}

export function useLanguage() {
  function t(key: string): string {
    return dictionary[key]?.[currentLanguage.value] ?? key;
  }

  return {
    currentLanguage,
    setLanguage,
    t,
  };
}
