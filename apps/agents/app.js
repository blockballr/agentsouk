import { roster } from "./roster.js";

const grid = document.querySelector("#grid");

function card(agent, index) {
  const article = document.createElement("article");
  article.className = "ds-card";
  article.setAttribute("aria-labelledby", `agent-${index}`);

  const body = document.createElement("div");
  body.className = "ds-card__body";

  const mark = document.createElement("div");
  mark.className = "ds-card__mark";
  const image = document.createElement("img");
  image.src = agent.mark;
  image.alt = "";
  image.width = 48;
  image.height = 48;
  image.loading = "lazy";
  image.decoding = "async";
  mark.append(image);

  const category = document.createElement("p");
  category.className = "ds-card__category";
  category.textContent = agent.category;

  const title = document.createElement("h2");
  title.className = "ds-card__title";
  title.id = `agent-${index}`;
  title.textContent = agent.name;

  const tagline = document.createElement("p");
  tagline.className = "ds-card__line";
  tagline.textContent = agent.tagline;

  const status = document.createElement("p");
  status.className = "ds-card__status";
  const dot = document.createElement("span");
  dot.className = "ds-dot ds-dot--live";
  dot.setAttribute("aria-hidden", "true");
  status.append(dot, document.createTextNode(agent.status));

  body.append(mark, category, title, tagline, status);
  article.append(body);

  const foot = document.createElement("div");
  foot.className = "ds-card__foot";

  const primary = document.createElement("a");
  primary.className = "ds-card__link ds-card__link--primary";
  primary.href = agent.primary;
  primary.setAttribute("aria-label", `${agent.action} ${agent.name}`);
  primary.append(document.createTextNode(agent.action + " "));
  const arrow = document.createElement("span");
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "\u2192";
  primary.append(arrow);
  foot.append(primary);

  if (agent.secondary) {
    const secondary = document.createElement("a");
    secondary.className = "ds-card__link ds-card__link--secondary";
    secondary.href = agent.secondary;
    secondary.textContent = "Hire on Agent Souk";
    foot.append(secondary);
  }

  article.append(foot);
  return article;
}

const fragment = document.createDocumentFragment();
roster.forEach((agent, index) => fragment.append(card(agent, index)));
grid.append(fragment);
