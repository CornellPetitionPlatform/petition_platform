---
title: Home
layout: default
---

<section class="hero">
  <h1>Petition Platform</h1>
  <p>A repository of anonymously written petitions, as contributed by participants in an STech Lab Study. </p>
  <a class="cta" href="/about/">Learn more</a>
</section>

<section class="petition-list">
  {% for p in site.petitions %}
    <a class="petition-card" href="{{ p.url | relative_url }}">
      <div class="petition-card__body">
        <h3 class="petition-card__title">{{ p.title }}</h3>
        <p class="petition-card__excerpt">
          {{ p.content | markdownify | strip_html | strip_newlines | truncate: 170 }}
        </p>
      </div>
      <div class="petition-card__chevron" aria-hidden="true">→</div>
    </a>
  {% endfor %}
</section>

