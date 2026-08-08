import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PersonActions } from '@/components/person-actions';
import { Timeline } from '@/components/timeline';
import { requireOperator } from '@/lib/auth';
import type { DevStage, Tier } from '@/lib/db/enums';
import {
  STAGE_DESCRIPTION,
  STAGE_LABEL,
  TIER_LABEL,
  formatDate,
  formatMoney,
  formatOverdue,
  formatRelative,
  tierTextClass,
} from '@/lib/format';
import { formatPhone, telHref } from '@/lib/phone';
import { getPersonDetail } from '@/lib/queries';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const detail = await getPersonDetail(id);
  return { title: detail?.person.full_name ?? 'Person' };
}

/**
 * Person detail. A single scroll, in the order the operator actually needs it:
 * who they are, where the relationship stands, how to reach them, then the
 * record.
 *
 * For an uncontacted record the header is different — reason, priority,
 * referrer, attempts and warm paths, with tier and cadence inert. Showing a
 * cadence for someone you have never spoken to would be a lie.
 */
export default async function PersonPage({ params }: Props) {
  await requireOperator();
  const { id } = await params;

  const detail = await getPersonDetail(id);
  if (!detail) notFound();

  const {
    person,
    recency,
    value,
    reciprocity,
    stage,
    touchpoints,
    notes,
    followups,
    favors,
    content,
    deals,
    introductionsMade,
    referrer,
    tierHistory,
    affiliations,
    paths,
  } = detail;

  const isWatchlist = person.contact_status === 'uncontacted';
  const organization = person.organization as { id: string; name: string; industry_category: string | null } | null;
  const pinned = notes.filter((n) => n.is_pinned);
  const unpinned = notes.filter((n) => !n.is_pinned);
  const openFollowups = followups.filter((f) => f.status === 'open');
  const attempts = touchpoints.filter((t) => t.direction === 'outbound');

  return (
    <main className="py-6">
      {/* ------------------------------------------------------------------ */}
      {/* Descriptor header                                                   */}
      {/* ------------------------------------------------------------------ */}
      <header className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{person.full_name}</h1>
            {person.preferred_name && person.preferred_name !== person.first_name ? (
              <p className="text-sm text-ink-soft">Goes by {person.preferred_name}</p>
            ) : null}
            {person.name_pronunciation ? (
              <p className="text-sm text-ink-faint">{person.name_pronunciation}</p>
            ) : null}

            <p className="mt-1 text-sm text-ink-soft">
              {[person.position, organization?.name].filter(Boolean).join(' · ') || '—'}
            </p>
            <p className="mt-0.5 text-sm text-ink-faint">
              {[person.city, person.state].filter(Boolean).join(', ') || 'No location recorded'}
            </p>
          </div>

          <div className="flex flex-col items-end gap-1">
            {isWatchlist ? (
              <span className="rounded-full border border-warn px-2.5 py-1 text-xs font-medium text-warn">
                Watchlist · not yet in contact
              </span>
            ) : (
              <>
                <span className={`font-mono text-sm font-semibold ${tierTextClass(person.tier)}`}>
                  {TIER_LABEL[person.tier as Tier]}
                </span>
                {recency ? (
                  <span
                    className={`text-xs ${(recency.days_overdue ?? 0) > 0 ? 'text-overdue' : 'text-ink-faint'}`}
                  >
                    {recency.is_paused
                      ? `Paused until ${formatDate(recency.cadence_paused_until)}`
                      : formatOverdue(recency.days_overdue)}
                  </span>
                ) : null}
              </>
            )}
            <Link href={`/person/${person.id}/edit`} className="text-xs text-accent hover:underline">
              Edit
            </Link>
          </div>
        </div>

        <DescriptorChips
          professionalFunction={person.professional_function}
          specialties={person.specialties}
          relationshipToMe={person.relationship_to_me}
          tags={person.tags}
        />
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* Watchlist header, or stage + value for an active record             */}
      {/* ------------------------------------------------------------------ */}
      {isWatchlist ? (
        <section className="card mb-6 p-4">
          <h2 className="label">Why they are worth meeting</h2>
          <p className="text-sm">{person.watchlist_reason}</p>

          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Priority" value={person.watchlist_priority ?? '—'} />
            <Stat label="Source" value={person.watchlist_source ?? '—'} />
            <Stat label="Added" value={formatDate(person.watchlist_added_on)} />
            <Stat label="Attempts" value={String(attempts.length)} />
          </dl>

          {/*
            Deliberately no staleness indicator. A watchlist entry's value is
            contingent on a trigger that has no schedule, so time elapsed says
            nothing about it.
          */}

          {paths.length > 0 ? (
            <div className="mt-4 border-t border-line-soft pt-3">
              <h3 className="label">Warm paths</h3>
              <ul className="space-y-1 text-sm">
                {paths.slice(0, 5).map((path) => (
                  <li key={path.connector_person_id} className="flex flex-wrap items-baseline gap-2">
                    <Link
                      href={`/person/${path.connector_person_id}`}
                      className="font-medium hover:underline"
                    >
                      {path.connector_name}
                    </Link>
                    <span className="text-xs text-ink-faint">{path.path_reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-4 border-t border-line-soft pt-3 text-sm text-ink-faint">
              No warm path found. A cold approach is the only route in.
            </p>
          )}
        </section>
      ) : (
        <section className="mb-6 grid gap-3 sm:grid-cols-3">
          <div className="card p-4">
            <h2 className="label">Stage</h2>
            <p className="text-lg font-medium">{stage ? STAGE_LABEL[stage as DevStage] : '—'}</p>
            <p className="mt-1 text-xs text-ink-faint">
              {stage ? STAGE_DESCRIPTION[stage as DevStage] : 'No qualifying contact yet.'}
            </p>
            {tierHistory.length > 1 ? (
              <p className="mt-2 text-xs text-ink-soft">
                Tier {tierHistory[0]?.to_tier} → {person.tier} over {tierHistory.length - 1}{' '}
                {tierHistory.length === 2 ? 'change' : 'changes'}
              </p>
            ) : null}
          </div>

          <div className="card p-4">
            <h2 className="label">Computed value</h2>
            <p className="text-lg font-medium">{value ? Number(value.value_score).toFixed(0) : '—'}</p>
            <p className="mt-1 text-xs text-ink-faint">
              {value
                ? `${value.intros_received_count} intros · ${(Number(value.inbound_initiation_ratio) * 100).toFixed(0)}% inbound · reach ${value.network_centrality}`
                : 'Not scored.'}
            </p>
          </div>

          <div className="card p-4">
            <h2 className="label">Reciprocity</h2>
            <p className="text-lg font-medium">
              {reciprocity ? (reciprocity.net_balance > 0 ? '+' : '') + reciprocity.net_balance : '—'}
            </p>
            <p className="mt-1 text-xs text-ink-faint">
              {reciprocity?.is_owed
                ? `You owe them. ${reciprocity.favors_received} received, ${reciprocity.favors_given} given.`
                : reciprocity
                  ? `${reciprocity.favors_given} given, ${reciprocity.favors_received} received.`
                  : 'No favours recorded.'}
            </p>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Actions                                                             */}
      {/* ------------------------------------------------------------------ */}
      <PersonActions
        personId={person.id}
        isWatchlist={isWatchlist}
        currentTier={person.tier}
        doNotContact={person.do_not_contact}
      />

      {/* ------------------------------------------------------------------ */}
      {/* Contact + provenance                                                */}
      {/* ------------------------------------------------------------------ */}
      <section className="card mt-6 p-4">
        <h2 className="label">Contact</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Contact label="Work email" value={person.email_work} href={person.email_work ? `mailto:${person.email_work}` : null} />
          <Contact label="Personal email" value={person.email_personal} href={person.email_personal ? `mailto:${person.email_personal}` : null} />
          <Contact
            label={person.preferred_phone === 'mobile' ? 'Mobile — preferred' : 'Mobile'}
            value={formatPhone(person.phone_mobile)}
            href={telHref(person.phone_mobile)}
          />
          <Contact
            label={person.preferred_phone === 'office' ? 'Office — preferred' : 'Office'}
            value={formatPhone(person.phone_office)}
            href={telHref(person.phone_office)}
          />
          <Contact label="LinkedIn" value={person.linkedin_url} href={person.linkedin_url} />
          <Contact label="Other" value={person.other_url} href={person.other_url} />
        </dl>

        {person.do_not_contact ? (
          <p className="mt-3 rounded-md border border-overdue px-3 py-2 text-xs text-overdue">
            Do not contact. Excluded from the queue and every export.
          </p>
        ) : null}

        <div className="mt-4 grid gap-2 border-t border-line-soft pt-3 text-sm sm:grid-cols-2">
          {referrer ? (
            <div>
              <dt className="label">Referred by</dt>
              <dd>
                <Link href={`/person/${referrer.id}`} className="text-accent hover:underline">
                  {referrer.full_name}
                </Link>
              </dd>
            </div>
          ) : person.introduced_by_external ? (
            <div>
              <dt className="label">Referred by</dt>
              <dd>{person.introduced_by_external}</dd>
            </div>
          ) : null}

          {!isWatchlist ? (
            <div>
              <dt className="label">Met at</dt>
              <dd>
                {person.met_at_source_id ? (
                  <Link href={`/sources/${person.met_at_source_id}`} className="text-accent hover:underline">
                    {formatDate(person.met_on)}
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          ) : null}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Everyone this person has introduced the operator to                 */}
      {/* ------------------------------------------------------------------ */}
      {introductionsMade.length > 0 ? (
        <section className="card mt-4 p-4">
          <h2 className="label">Introduced you to</h2>
          <p className="mb-2 text-xs text-ink-faint">
            Frequently the difference between an A and a C.
          </p>
          <ul className="space-y-1 text-sm">
            {introductionsMade.map((intro) => {
              const party = intro.party_a as unknown as { id: string; full_name: string; tier: Tier } | null;
              if (!party) return null;
              return (
                <li key={intro.id} className="flex flex-wrap items-baseline gap-2">
                  <Link href={`/person/${party.id}`} className="font-medium hover:underline">
                    {party.full_name}
                  </Link>
                  <span className={`font-mono text-xs ${tierTextClass(party.tier)}`}>{party.tier}</span>
                  <span className="text-xs text-ink-faint">{formatDate(intro.occurred_on)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* Notes                                                               */}
      {/* ------------------------------------------------------------------ */}
      {notes.length > 0 ? (
        <section className="card mt-4 p-4">
          <h2 className="label">Notes</h2>
          <ul className="space-y-2 text-sm">
            {[...pinned, ...unpinned].map((note) => (
              <li key={note.id} className="flex gap-2">
                {note.is_pinned ? <span className="text-warn">★</span> : <span className="text-ink-faint">·</span>}
                <div>
                  <p>{note.body}</p>
                  <p className="text-xs text-ink-faint">{note.category}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* Followups, deals, favours, content                                  */}
      {/* ------------------------------------------------------------------ */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {openFollowups.length > 0 ? (
          <section className="card p-4">
            <h2 className="label">Open follow-ups</h2>
            <ul className="space-y-1 text-sm">
              {openFollowups.map((followup) => (
                <li key={followup.id} className="flex justify-between gap-2">
                  <span>{followup.title}</span>
                  <span className="shrink-0 text-xs text-ink-faint">{formatDate(followup.due_on)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {deals.length > 0 ? (
          <section className="card p-4">
            <h2 className="label">Deals sourced</h2>
            <ul className="space-y-1 text-sm">
              {deals.map((deal) => (
                <li key={deal.id} className="flex justify-between gap-2">
                  <span>{deal.name}</span>
                  <span className="shrink-0 text-xs text-ink-faint">
                    {deal.stage} · {formatMoney(deal.amount_cents)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {favors.length > 0 ? (
          <section className="card p-4">
            <h2 className="label">Favours</h2>
            <ul className="space-y-1 text-sm">
              {favors.map((favor) => (
                <li key={favor.id} className="flex justify-between gap-2">
                  <span>
                    <span className={favor.direction === 'received' ? 'text-ok' : 'text-ink-soft'}>
                      {favor.direction === 'received' ? 'They gave' : 'You gave'}
                    </span>{' '}
                    {favor.description ?? favor.kind}
                  </span>
                  <span className="shrink-0 text-xs text-ink-faint">{formatDate(favor.occurred_on)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {content.length > 0 ? (
          <section className="card p-4">
            <h2 className="label">Content sent</h2>
            <ul className="space-y-1 text-sm">
              {content.map((item) => (
                <li key={item.id} className="flex justify-between gap-2">
                  <span>{item.content_title}</span>
                  <span className="shrink-0 text-xs text-ink-faint">{formatDate(item.sent_on)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {affiliations.length > 0 ? (
          <section className="card p-4">
            <h2 className="label">Previously</h2>
            <ul className="space-y-1 text-sm">
              {affiliations.map((affiliation) => (
                <li key={affiliation.id} className="flex justify-between gap-2">
                  <span>
                    {affiliation.position ?? 'Unknown role'}
                    {affiliation.organization_name ? ` at ${affiliation.organization_name}` : ''}
                  </span>
                  <span className="shrink-0 text-xs text-ink-faint">
                    until {formatDate(affiliation.ended_on)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Timeline                                                            */}
      {/* ------------------------------------------------------------------ */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-ink-soft uppercase">
          {isWatchlist ? 'Attempts and research' : 'Timeline'}
        </h2>
        {touchpoints.length === 0 ? (
          <p className="card p-4 text-sm text-ink-faint">
            {isWatchlist
              ? 'No attempts logged yet.'
              : 'No touchpoints recorded — unusual for an active record.'}
          </p>
        ) : (
          <Timeline touchpoints={touchpoints} />
        )}
      </section>

      {recency ? (
        <p className="mt-6 text-xs text-ink-faint">
          Last contact {formatRelative(recency.last_touch_at)} · last substantive{' '}
          {formatRelative(recency.last_substantive_at)} · {recency.touch_count_365d} touches in the last
          year.
        </p>
      ) : null}
    </main>
  );
}

function DescriptorChips({
  professionalFunction,
  specialties,
  relationshipToMe,
  tags,
}: {
  professionalFunction: string[];
  specialties: string[];
  relationshipToMe: string[];
  tags: string[];
}) {
  const groups: Array<[string, string[], string]> = [
    ['Does', professionalFunction, 'border-line'],
    ['Knows', specialties, 'border-accent/40'],
    ['To me', relationshipToMe, 'border-ok/40'],
    ['Tags', tags, 'border-line-soft'],
  ];

  const present = groups.filter(([, values]) => values.length > 0);
  if (present.length === 0) return null;

  return (
    <div className="mt-3 space-y-1.5">
      {present.map(([label, values, borderClass]) => (
        <div key={label} className="flex flex-wrap items-baseline gap-1.5">
          <span className="w-12 shrink-0 text-[10px] tracking-wide text-ink-faint uppercase">
            {label}
          </span>
          {values.map((value) => (
            <span key={value} className={`rounded-full border px-2 py-0.5 text-xs ${borderClass}`}>
              {value}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="capitalize">{value}</dd>
    </div>
  );
}

function Contact({
  label,
  value,
  href,
}: {
  label: string;
  value: string | null;
  href: string | null;
}) {
  if (!value) return null;
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="truncate">
        {href ? (
          <a href={href} className="text-accent hover:underline">
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
