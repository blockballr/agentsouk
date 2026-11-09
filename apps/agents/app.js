import { roster } from "./roster.js";

const grid = document.querySelector("#grid");

function card(agent) {
  const article = document.createElement("article");
  article.className = "card";

  const link = document.createElement("a");
  link.className = "card-link";
  link.href = agent.primary;
  link.setAttribute("aria-label", `${agent.action} ${agent.name}`);
  article.append(link);

  const body = document.createElement("div");
  body.className = "card-body";

  const mark = document.createElement("div");
  mark.className = "mark";
  const image = document.createElement("img");
  image.src = agent.mark;
  image.alt = "";
  image.width = 56;
  image.height = 56;
  image.loading = "lazy";
  image.decoding = "async";
  mark.append(image);

  const category = document.createElement("p");
  category.className = "category";
  category.textContent = agent.category;

  const title = document.createElement("h2");
  title.textContent = agent.name;

  const tagline = document.createElement("p");
  tagline.className = "tagline";
  tagline.textContent = agent.tagline;

  const status = document.createElement("p");
  status.className = "status";
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.setAttribute("aria-hidden", "true");
  status.append(dot, document.createTextNode(agent.status));

  body.append(mark, category, title, tagline, status);
  article.append(body);

  const foot = document.createElement("div");
  foot.className = "card-foot";
  const action = document.createElement("span");
  action.className = "action";
  action.textContent = agent.action;
  const arrow = document.createElement("span");
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = " \u2192";
  action.append(arrow);
  foot.append(action);

  if (agent.secondary) {
    const secondary = document.createElement("a");
    secondary.className = "secondary";
    secondary.href = agent.secondary;
    secondary.textContent = "Hire on Agent Souk";
    foot.append(secondary);
  }

  article.append(foot);
  return article;
}

const fragment = document.createDocumentFragment();
for (const agent of roster) fragment.append(card(agent));
grid.append(fragment);
