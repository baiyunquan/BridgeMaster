import { createRouter, createWebHistory } from "vue-router";
import LobbyView from "@/views/LobbyView.vue";
import PlayerView from "@/views/PlayerView.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "lobby",
      component: LobbyView,
    },
    {
      path: "/player/:playerId",
      name: "player",
      component: PlayerView,
      props: true,
    },
  ],
});

export default router;
