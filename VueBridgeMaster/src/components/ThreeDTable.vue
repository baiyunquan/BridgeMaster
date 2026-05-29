<script setup lang="ts">
import { computed, reactive } from "vue";
import { TresCanvas } from "@tresjs/core";
import { CanvasTexture, DoubleSide, LinearFilter, SRGBColorSpace, Texture, TextureLoader } from "three";
import { useLanguage } from "@/composables/useLanguage";
import type { Card, PlayerPosition, Room } from "@/types";

type SeatSlot = "bottom" | "left" | "top" | "right";
type HandAxis = "horizontal" | "vertical";

interface OverlaySeatViewModel {
  position: PlayerPosition;
  slot: SeatSlot;
  player: NonNullable<ReturnType<typeof playerAt>>;
  cardsCount: number;
  revealed: boolean;
  isDummy: boolean;
  isCurrentTurn: boolean;
  labelLeft: string;
  labelTop: string;
  hiddenLeft: string;
  hiddenTop: string;
}

interface SceneCardViewModel {
  key: string;
  card: Card;
  position: [number, number, number];
  rotation: [number, number, number];
  texture: Texture | null;
  renderOrder: number;
  clickable: boolean;
  dimmed: boolean;
}

interface HiddenBackViewModel {
  key: string;
  position: [number, number, number];
  rotation: [number, number, number];
  renderOrder: number;
}

interface TrickCardViewModel {
  key: string;
  position: [number, number, number];
  rotation: [number, number, number];
  texture: Texture | null;
  playerLabel: PlayerPosition;
  renderOrder: number;
}

const TABLE_SIZE = 8;
const TABLE_RIM_SIZE = 8.6;
const TABLE_RIM_HEIGHT = 0.32;
const HAND_DISTANCE = 3.7;
const TRICK_DISTANCE = 1.15;
const CARD_WIDTH = 0.9;
const CARD_HEIGHT = 1.26;
const CARD_OVERLAP_RATIO = 0.5;
const CARD_LIFT = 0.05;
const TRICK_LIFT = 0.12;
const CARD_LAYER_STEP = 0.0025;
const BACK_COUNT = 6;
const CAMERA_Y = 7.4;
const CAMERA_Z = 7.6;
const CAMERA_TILT = -Math.atan(CAMERA_Y / CAMERA_Z);
const TABLE_PLANE_ROTATION: [number, number, number] = [-Math.PI / 2, 0, 0];

const SLOT_LABELS: Record<SeatSlot, { left: number; top: number }> = {
  bottom: { left: 50, top: 97 },
  top: { left: 50, top: 3 },
  left: { left: 7, top: 50 },
  right: { left: 93, top: 50 },
};

const HIDDEN_COUNT_LABELS: Record<SeatSlot, { left: number; top: number }> = {
  bottom: { left: 50, top: 84 },
  top: { left: 50, top: 16 },
  left: { left: 9, top: 74 },
  right: { left: 91, top: 74 },
};

const HAND_ANCHORS: Record<SeatSlot, { x: number; z: number; axis: HandAxis; angle: number }> = {
  bottom: { x: 0, z: HAND_DISTANCE, axis: "horizontal", angle: 0 },
  top: { x: 0, z: -HAND_DISTANCE, axis: "horizontal", angle: Math.PI },
  left: { x: -HAND_DISTANCE, z: 0, axis: "vertical", angle: Math.PI / 2 },
  right: { x: HAND_DISTANCE, z: 0, axis: "vertical", angle: -Math.PI / 2 },
};

const TRICK_ANCHORS: Record<SeatSlot, { x: number; z: number; angle: number }> = {
  bottom: { x: 0, z: TRICK_DISTANCE, angle: 0 },
  top: { x: 0, z: -TRICK_DISTANCE, angle: Math.PI },
  left: { x: -TRICK_DISTANCE, z: 0, angle: Math.PI / 2 },
  right: { x: TRICK_DISTANCE, z: 0, angle: -Math.PI / 2 },
};

const props = defineProps<{
  room: Room;
  playerId: string;
}>();

const emit = defineEmits<{
  submit: [card: Card];
}>();

const { t } = useLanguage();
const positions: PlayerPosition[] = ["N", "E", "S", "W"];
const textureLoader = new TextureLoader();
const textureCache = reactive<Record<string, Texture | null>>({});
const backTexture = createBackTexture();

const myPosition = computed(() => props.room.players.find((player) => player.id === props.playerId)?.position ?? null);
const leadSuit = computed(() => props.room.gameState.currentTrick?.cards[0]?.card.suit ?? null);
const isMyTurn = computed(() => props.room.gameState.turn === myPosition.value);

function createBackTexture(): Texture | null {
  if (typeof document === "undefined") {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 360;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  context.fillStyle = "#1b4f95";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(255, 255, 255, 0.16)";
  for (let x = -canvas.height; x < canvas.width + canvas.height; x += 26) {
    context.fillRect(x, 0, 10, canvas.height);
  }
  context.strokeStyle = "rgba(255, 255, 255, 0.82)";
  context.lineWidth = 10;
  context.strokeRect(16, 16, canvas.width - 32, canvas.height - 32);
  context.strokeStyle = "rgba(255, 255, 255, 0.42)";
  context.lineWidth = 4;
  context.strokeRect(30, 30, canvas.width - 60, canvas.height - 60);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function cardKey(card: Card): string {
  return `${card.rank}${card.suit}`;
}

function ensureCardTexture(card: Card): Texture | null {
  const key = cardKey(card);
  if (key in textureCache) {
    return textureCache[key];
  }

  textureCache[key] = null;
  textureLoader.load(`/cards/vector-cards/cards-svg/${key}.svg`, (texture) => {
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = false;
    textureCache[key] = texture;
  });

  return null;
}

function playerAt(position: PlayerPosition) {
  return props.room.players.find((player) => player.position === position) ?? null;
}

function cardsAt(position: PlayerPosition) {
  return props.room.gameState.hands[position] ?? [];
}

function slotFor(position: PlayerPosition): SeatSlot {
  if (!myPosition.value) {
    return position === "S" ? "bottom" : position === "W" ? "left" : position === "N" ? "top" : "right";
  }

  const myIndex = positions.indexOf(myPosition.value);
  const positionIndex = positions.indexOf(position);
  const diff = (positionIndex - myIndex + 4) % 4;

  if (diff === 0) {
    return "bottom";
  }
  if (diff === 1) {
    return "left";
  }
  if (diff === 2) {
    return "top";
  }
  return "right";
}

function canReveal(position: PlayerPosition): boolean {
  return position === myPosition.value || (props.room.gameState.isDummyRevealed && position === props.room.gameState.dummyPosition);
}

function isLegal(card: Card): boolean {
  if (!leadSuit.value || !myPosition.value) {
    return true;
  }

  const myHand = cardsAt(myPosition.value);
  const hasLeadSuit = myHand.some((candidate) => candidate.suit === leadSuit.value);
  if (!hasLeadSuit) {
    return true;
  }

  return card.suit === leadSuit.value;
}

function cardStep(axis: HandAxis): number {
  const base = axis === "horizontal" ? CARD_WIDTH : CARD_HEIGHT;
  return base * CARD_OVERLAP_RATIO;
}

function cardRotation(slot: SeatSlot): [number, number, number] {
  return [-Math.PI / 2, 0, HAND_ANCHORS[slot].angle];
}

function layoutCardPositions(
  cardCount: number,
  slot: SeatSlot,
  lift: number,
): Array<{ position: [number, number, number]; rotation: [number, number, number]; renderOrder: number }> {
  const anchor = HAND_ANCHORS[slot];
  const step = cardStep(anchor.axis);
  const centerIndex = (cardCount - 1) / 2;

  return Array.from({ length: cardCount }, (_, index) => {
    const offset = (index - centerIndex) * step;
    const x = anchor.axis === "horizontal" ? anchor.x + offset : anchor.x;
    const z = anchor.axis === "horizontal" ? anchor.z : anchor.z + offset;
    return {
      position: [x, lift + index * CARD_LAYER_STEP, z],
      rotation: cardRotation(slot),
      renderOrder: 20 + index,
    };
  });
}

function handleCardClick(entry: SceneCardViewModel): void {
  if (!entry.clickable) {
    return;
  }

  emit("submit", entry.card);
}

const overlaySeats = computed(() => {
  return positions
    .map((position) => {
      const player = playerAt(position);
      if (!player) {
        return null;
      }

      const slot = slotFor(position);
      const label = SLOT_LABELS[slot];
      const hidden = HIDDEN_COUNT_LABELS[slot];
      return {
        position,
        slot,
        player,
        cardsCount: cardsAt(position).length,
        revealed: canReveal(position),
        isDummy: props.room.gameState.isDummyRevealed && position === props.room.gameState.dummyPosition,
        isCurrentTurn: props.room.gameState.turn === position,
        labelLeft: `${label.left}%`,
        labelTop: `${label.top}%`,
        hiddenLeft: `${hidden.left}%`,
        hiddenTop: `${hidden.top}%`,
      } satisfies OverlaySeatViewModel;
    })
    .filter((seat): seat is NonNullable<typeof seat> => seat !== null);
});

const revealedCards = computed(() => {
  return overlaySeats.value.flatMap((seat) => {
    if (!seat.revealed) {
      return [];
    }

    const cards = cardsAt(seat.position);
    const layout = layoutCardPositions(cards.length, seat.slot, CARD_LIFT);

    return cards.map((card, index) => {
      const mine = seat.position === myPosition.value;
      const legal = mine ? isLegal(card) : true;
      return {
        key: `${seat.position}-${card.suit}-${card.rank}`,
        card,
        position: layout[index].position,
        rotation: layout[index].rotation,
        texture: ensureCardTexture(card),
        renderOrder: layout[index].renderOrder,
        clickable: mine && isMyTurn.value && legal,
        dimmed: mine ? !isMyTurn.value || !legal : false,
      } satisfies SceneCardViewModel;
    });
  });
});

const hiddenBacks = computed(() => {
  return overlaySeats.value.flatMap((seat) => {
    if (seat.revealed) {
      return [];
    }

    const count = Math.min(seat.cardsCount, BACK_COUNT);
    const layout = layoutCardPositions(count, seat.slot, CARD_LIFT);
    return layout.map((entry, index) => ({
      key: `${seat.position}-back-${index}`,
      position: entry.position,
      rotation: entry.rotation,
      renderOrder: entry.renderOrder,
    } satisfies HiddenBackViewModel));
  });
});

const currentTrickCards = computed(() => {
  return (props.room.gameState.currentTrick?.cards ?? []).map((play, index) => ({
    key: `${play.playerId}-${play.card.suit}-${play.card.rank}`,
    position: [TRICK_ANCHORS[slotFor(play.position)].x, TRICK_LIFT + index * CARD_LAYER_STEP, TRICK_ANCHORS[slotFor(play.position)].z] as [number, number, number],
    rotation: [-Math.PI / 2, 0, TRICK_ANCHORS[slotFor(play.position)].angle] as [number, number, number],
    texture: ensureCardTexture(play.card),
    playerLabel: play.position,
    renderOrder: 120 + index,
  } satisfies TrickCardViewModel));
});
</script>

<template>
  <section class="three-d-stage">
    <div class="section-title">
      <h3>{{ t("table3d") }}</h3>
      <span class="badge" :class="isMyTurn ? 'ok' : ''">{{ isMyTurn ? t("playStage") : t("waitingOthers") }}</span>
    </div>

    <div class="three-d-wrapper">
      <div class="three-d-table three-d-webgl-table">
        <TresCanvas class="three-webgl-canvas" clear-color="#eef4ff" :clear-alpha="1" :alpha="false">
          <TresPerspectiveCamera :position="[0, CAMERA_Y, CAMERA_Z]" :rotation="[CAMERA_TILT, 0, 0]" :fov="36" />
          <TresAmbientLight :intensity="2.2" />
          <TresDirectionalLight :position="[5, 9, 4]" :intensity="1.35" />
          <TresDirectionalLight :position="[-4, 6, -3]" :intensity="0.55" />

          <TresMesh :position="[0, -0.18, 0]">
            <TresBoxGeometry :args="[TABLE_RIM_SIZE, TABLE_RIM_HEIGHT, TABLE_RIM_SIZE]" />
            <TresMeshStandardMaterial color="#7a4f31" :roughness="0.92" :metalness="0.06" />
          </TresMesh>

          <TresMesh :position="[0, 0.01, 0]" :rotation="TABLE_PLANE_ROTATION">
            <TresPlaneGeometry :args="[TABLE_SIZE, TABLE_SIZE]" />
            <TresMeshStandardMaterial color="#17875f" :roughness="0.95" :metalness="0.03" />
          </TresMesh>

          <TresMesh :position="[0, 0.015, 0]" :rotation="TABLE_PLANE_ROTATION">
            <TresRingGeometry :args="[2.48, 2.54, 4]" />
            <TresMeshBasicMaterial color="#0f6e4d" />
          </TresMesh>

          <TresMesh v-for="back in hiddenBacks" :key="back.key" :position="back.position" :rotation="back.rotation" :render-order="back.renderOrder">
            <TresPlaneGeometry :args="[CARD_WIDTH, CARD_HEIGHT]" />
            <TresMeshBasicMaterial
              :map="backTexture ?? undefined"
              color="#1d4f9b"
              :transparent="true"
              :depth-write="false"
              :side="DoubleSide"
            />
          </TresMesh>

          <TresMesh
            v-for="entry in revealedCards"
            :key="entry.key"
            :position="entry.position"
            :rotation="entry.rotation"
            :render-order="entry.renderOrder"
            @click="handleCardClick(entry)"
          >
            <TresPlaneGeometry :args="[CARD_WIDTH, CARD_HEIGHT]" />
            <TresMeshBasicMaterial
              :map="entry.texture ?? undefined"
              color="#ffffff"
              :transparent="true"
              :depth-write="false"
              :opacity="entry.dimmed ? 0.52 : 1"
              :side="DoubleSide"
            />
          </TresMesh>

          <TresMesh v-for="play in currentTrickCards" :key="play.key" :position="play.position" :rotation="play.rotation" :render-order="play.renderOrder">
            <TresPlaneGeometry :args="[CARD_WIDTH * 0.9, CARD_HEIGHT * 0.9]" />
            <TresMeshBasicMaterial
              :map="play.texture ?? undefined"
              color="#ffffff"
              :transparent="true"
              :depth-write="false"
              :side="DoubleSide"
            />
          </TresMesh>
        </TresCanvas>

        <div class="three-d-overlay">
          <div v-for="seat in overlaySeats" :key="`${seat.position}-label`" class="table-seat" :class="[`seat-${seat.slot}`, { active: seat.isCurrentTurn }]">
            <div class="table-seat-label" :style="{ left: seat.labelLeft, top: seat.labelTop }">
              <strong>{{ seat.position }}</strong>
              <span>{{ seat.player.name }}</span>
              <small>
                {{ seat.player.id }}
                <template v-if="seat.isDummy">· {{ t("dummyHand") }}</template>
              </small>
            </div>

            <span
              v-if="!seat.revealed"
              class="hidden-count"
              :style="{ left: seat.hiddenLeft, top: seat.hiddenTop, transform: 'translate(-50%, -50%)' }"
            >
              {{ seat.cardsCount }} {{ t("hiddenHand") }}
            </span>
          </div>

          <div v-if="currentTrickCards.length === 0" class="trick-empty">{{ t("noCurrentTrick") }}</div>

          <div
            v-for="play in currentTrickCards"
            :key="`${play.key}-label`"
            class="trick-play-label"
            :style="{
              left: `${50 + (play.position[0] / TABLE_SIZE) * 50}%`,
              top: `${50 + (play.position[2] / TABLE_SIZE) * 44}%`,
            }"
          >
            {{ play.playerLabel }}
          </div>
        </div>
      </div>
    </div>

    <div class="status-strip compact-strip">
      <span class="badge">{{ t("currentTrick") }}: {{ room.gameState.currentTrick?.cards.length ?? 0 }}/4</span>
      <span class="badge">{{ t("contractCurrent") }}: {{ room.gameState.contract ? `${room.gameState.contract.level} ${room.gameState.contract.strain}` : '-' }}</span>
    </div>
  </section>
</template>