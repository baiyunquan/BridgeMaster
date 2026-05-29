import { createRouter, createWebHistory } from "vue-router";
import LobbyView from "@/views/LobbyView.vue";
import PlayerPlayView from "@/views/PlayerPlayView.vue";
import PlayerResultView from "@/views/PlayerResultView.vue";
import PlayerSetupView from "@/views/PlayerSetupView.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "lobby",
      component: LobbyView,
    },
    {
      path: "/player/setup/:playerId",
      name: "player-setup",
      component: PlayerSetupView,
      props: true,
    },
    {
      path: "/player/play/:playerId",
      name: "player-play",
      component: PlayerPlayView,
      props: true,
    },
    {
      path: "/player/result/:playerId",
      name: "player-result",
      component: PlayerResultView,
      props: true,
    },
    {
      path: "/player/:playerId/setup",
      redirect: (to) => ({ name: "player-setup", params: { playerId: to.params.playerId }, query: to.query }),
    },
    {
      path: "/player/:playerId/play",
      redirect: (to) => ({ name: "player-play", params: { playerId: to.params.playerId }, query: to.query }),
    },
    {
      path: "/player/:playerId/result",
      redirect: (to) => ({ name: "player-result", params: { playerId: to.params.playerId }, query: to.query }),
    },
  ],
});

export default router;
