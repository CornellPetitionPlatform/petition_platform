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
  {% assign petitions_with_posted_at = site.petitions | where_exp: "p", "p.posted_at != blank" | sort: "posted_at" | reverse %}
  {% assign petitions_with_date = site.petitions | where_exp: "p", "p.posted_at == blank and p.date != blank" | sort: "date" | reverse %}
  {% assign petitions_with_recorded_date = site.petitions | where_exp: "p", "p.posted_at == blank and p.date == blank and p.qualtrics_recorded_date != blank" | sort: "qualtrics_recorded_date" | reverse %}
  {% assign petitions_without_dates = site.petitions | where_exp: "p", "p.posted_at == blank and p.date == blank and p.qualtrics_recorded_date == blank" %}
  {% assign petitions_sorted = petitions_with_posted_at | concat: petitions_with_date | concat: petitions_with_recorded_date | concat: petitions_without_dates %}

  {% for p in petitions_sorted %}
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
