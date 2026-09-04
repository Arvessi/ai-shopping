'use client';

import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ProductCard from './ProductCard';
import type {
  AiShoppingPlan,
  ProductResult,
} from '@/lib/types';

const categories = [
  ['📱', 'Telefoni', 'smartphone'],
  ['💻', 'Portatīvie', 'laptop'],
  ['🖥️', 'Monitori', 'monitor'],
  ['📺', 'TV', 'OLED TV'],
  ['🎧', 'Audio', 'wireless headphones'],
  ['🎮', 'Gaming', 'gaming computer'],
  ['📷', 'Kameras', 'mirrorless camera'],
  ['🏠', 'Mājai', 'smart home electronics'],
];

const fallbackPopular = [
  'iPhone 16',
  'Samsung Galaxy S25',
  'MacBook Air',
  'OLED TV 55',
  'gaming laptop',
];

const SEARCH_STATE_KEY =
  'ceniq-search-state-canonical-v1';

type SearchMode =
  | 'search'
  | 'assistant';

type SortMode =
  | 'coverage'
  | 'price'
  | 'score';

type SavedSearchState = {
  query: string;
  mode: SearchMode;
  results: ProductResult[];
  notice: string;
  plan: AiShoppingPlan | null;
  source?: string;
};

export default function SearchExperience() {
  const [mode, setMode] =
    useState<SearchMode>(
      'search',
    );
  const [query, setQuery] =
    useState('');
  const [results, setResults] =
    useState<
      ProductResult[]
    >([]);
  const [popular, setPopular] =
    useState<string[]>(
      fallbackPopular,
    );
  const [loading, setLoading] =
    useState(false);
  const [status, setStatus] =
    useState('');
  const [error, setError] =
    useState('');
  const [notice, setNotice] =
    useState('');
  const [plan, setPlan] =
    useState<
      AiShoppingPlan | null
    >(null);
  const [source, setSource] =
    useState('');
  const [restored, setRestored] =
    useState(false);
  const [sortMode, setSortMode] =
    useState<SortMode>(
      'coverage',
    );

  const enrichVersion =
    useRef(0);

  useEffect(() => {
    fetch('/api/popular')
      .then((response) =>
        response.json(),
      )
      .then((data) => {
        if (
          data.searches?.length
        ) {
          setPopular(
            data.searches,
          );
        }
      })
      .catch(
        () => undefined,
      );

    try {
      const saved =
        window.sessionStorage.getItem(
          SEARCH_STATE_KEY,
        );

      if (saved) {
        const parsed =
          JSON.parse(
            saved,
          ) as Partial<SavedSearchState>;

        if (
          typeof parsed.query ===
          'string'
        ) {
          setQuery(
            parsed.query,
          );
        }

        if (
          parsed.mode ===
            'assistant' ||
          parsed.mode ===
            'search'
        ) {
          setMode(
            parsed.mode,
          );
        }

        if (
          Array.isArray(
            parsed.results,
          )
        ) {
          setResults(
            parsed.results,
          );
        }

        if (
          typeof parsed.notice ===
          'string'
        ) {
          setNotice(
            parsed.notice,
          );
        }

        if (
          typeof parsed.source ===
          'string'
        ) {
          setSource(
            parsed.source,
          );
        }

        if (parsed.plan) {
          setPlan(
            parsed.plan,
          );
        }
      }
    } catch {
      window.sessionStorage.removeItem(
        SEARCH_STATE_KEY,
      );
    } finally {
      setRestored(true);
    }
  }, []);

  useEffect(() => {
    if (!restored) return;

    const state: SavedSearchState = {
      query,
      mode,
      results,
      notice,
      plan,
      source,
    };

    try {
      window.sessionStorage.setItem(
        SEARCH_STATE_KEY,
        JSON.stringify(
          state,
        ),
      );
    } catch {
      // Ignore storage errors.
    }
  }, [
    restored,
    query,
    mode,
    results,
    notice,
    plan,
    source,
  ]);

  const sortedResults =
    useMemo(() => {
      return [
        ...results,
      ].sort((a, b) => {
        if (
          sortMode ===
          'price'
        ) {
          return (
            a.bestPrice -
            b.bestPrice
          );
        }

        if (
          sortMode ===
          'score'
        ) {
          return (
            b.dealScore -
              a.dealScore ||
            (b.storesCount ||
              0) -
              (a.storesCount ||
                0)
          );
        }

        return (
          (b.storesCount ||
            0) -
            (a.storesCount ||
              0) ||
          b.dealScore -
            a.dealScore ||
          a.bestPrice -
            b.bestPrice
        );
      });
    }, [
      results,
      sortMode,
    ]);

  function updateUrl(
    searchQuery: string,
    searchMode: SearchMode,
  ) {
    const url = new URL(
      window.location.href,
    );

    url.searchParams.set(
      'q',
      searchQuery,
    );

    url.searchParams.set(
      'mode',
      searchMode,
    );

    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
  }

  async function runMerchantEnrichment(
    searchQuery: string,
    version: number,
  ) {
    try {
      setStatus(
        'Rezultāti ir gatavi — CENIQ fonā meklē vēl veikalus, variantus un bildes…',
      );

      const start = await fetch(
        '/api/merchant/enrich',
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify({
            q: searchQuery,
          }),
        },
      );

      const startData =
        await start.json();

      if (
        !start.ok ||
        !startData.taskId
      ) {
        setStatus('');
        return;
      }

      let taskId =
        String(startData.taskId);
      let stage =
        String(
          startData.stage ||
            'products',
        );
      let retryAfterMs = 750;

      for (
        let attempt = 0;
        attempt < 12;
        attempt += 1
      ) {
        if (
          enrichVersion.current !==
          version
        ) {
          return;
        }

        await new Promise(
          (resolve) =>
            window.setTimeout(
              resolve,
              retryAfterMs,
            ),
        );

        const poll = await fetch(
          `/api/merchant/enrich?taskId=${encodeURIComponent(
            taskId,
          )}&stage=${encodeURIComponent(
            stage,
          )}&q=${encodeURIComponent(
            searchQuery,
          )}`,
          {
            cache: 'no-store',
          },
        );

        const data =
          await poll.json();

        if (!poll.ok) {
          setStatus('');
          return;
        }

        if (
          Array.isArray(
            data.results,
          ) &&
          data.results.length
        ) {
          setResults(
            data.results,
          );

          setSource(
            data.source ||
              'canonical-enrichment',
          );

          setNotice('');
        }

        if (!data.pending) {
          setStatus('');
          return;
        }

        retryAfterMs = Math.min(8000, Math.max(500, Number(data.retryAfterMs || retryAfterMs * 1.7)));

        taskId = String(
          data.taskId ||
            taskId,
        );

        stage = String(
          data.stage ||
            stage,
        );

        setStatus(
          stage === 'info'
            ? 'Atrasti produkti — CENIQ tagad pārbauda pārdevējus, bildes un detalizētus datus…'
            : 'Rezultāti ir gatavi — CENIQ fonā paplašina Google Shopping katalogu…',
        );
      }

      setStatus('');
    } catch {
      setStatus('');
    }
  }

  async function runSearch(
    searchQuery: string,
    searchMode: SearchMode,
  ) {
    const version =
      ++enrichVersion.current;

    setStatus(
      'CENIQ pārbauda katalogu un veikalus…',
    );

    const controller =
      new AbortController();

    const timeout =
      window.setTimeout(
        () =>
          controller.abort(),
        20000,
      );

    try {
      const response =
        await fetch(
          '/api/search',
          {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json',
            },
            body: JSON.stringify({
              q: searchQuery,
              mode: searchMode,
            }),
            signal:
              controller.signal,
          },
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            'Meklēšana neizdevās.',
        );
      }

      const nextResults =
        Array.isArray(
          data.results,
        )
          ? data.results
          : [];

      setResults(
        nextResults,
      );

      setSource(
        data.source || '',
      );

      if (
        data.enrichment?.enabled
      ) {
        void runMerchantEnrichment(
          searchQuery,
          version,
        );
      }

      setSortMode(
        'coverage',
      );

      setNotice(
        nextResults.length ===
          0
          ? data.message ||
              'Nekas netika atrasts.'
          : '',
      );

      if (
        !data.enrichment?.enabled
      ) {
        setStatus('');
      }

      if (
        nextResults.length
      ) {
        window.setTimeout(
          () =>
            document
              .getElementById(
                'results',
              )
              ?.scrollIntoView({
                behavior:
                  'smooth',
                block: 'start',
              }),
          60,
        );
      }
    } finally {
      window.clearTimeout(
        timeout,
      );
    }
  }

  async function submit(
    e?: FormEvent,
    override?: string,
    forcedMode?: SearchMode,
  ) {
    e?.preventDefault();

    const activeMode =
      forcedMode ?? mode;

    const input = (
      override ?? query
    ).trim();

    if (
      !input ||
      loading
    ) {
      return;
    }

    setQuery(input);
    setMode(
      activeMode,
    );
    updateUrl(
      input,
      activeMode,
    );

    setLoading(true);
    setError('');
    setNotice('');
    setResults([]);
    setPlan(null);
    setSource('');

    try {
      if (
        activeMode ===
        'assistant'
      ) {
        setStatus(
          'CENIQ saprot tavas prasības…',
        );

        const response =
          await fetch(
            '/api/ai',
            {
              method: 'POST',
              headers: {
                'Content-Type':
                  'application/json',
              },
              body: JSON.stringify({
                prompt: input,
              }),
            },
          );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
              'CENIQ AI neizdevās.',
          );
        }

        setPlan(
          data.plan,
        );

        await runSearch(
          data.plan
            .searchQuery,
          'assistant',
        );
      } else {
        await runSearch(
          input,
          'search',
        );
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.name ===
            'AbortError'
            ? 'Meklēšana aizņēma pārāk ilgu laiku. Pamēģini vēlreiz.'
            : err.message
          : 'Radās kļūda.',
      );

      setStatus('');
    } finally {
      setLoading(false);
    }
  }

  const sourceLabel =
    source === 'canonical-catalog'
      ? 'CENIQ katalogs'
      : source === 'canonical-enrichment'
        ? 'CENIQ katalogs atjaunināts'
        : '';

  return (
    <>
      <section
        className="hero"
        id="meklet"
      >
        <div className="eyebrow">
          Latvijas cenu
          meklētājs
        </div>

        <h1>
          Atrodi labāko cenu.
          <br />
          <span>
            Pērc gudrāk.
          </span>
        </h1>

        <p>
          Viens produkts,
          varianti un veikalu
          cenas vienuviet.
        </p>

        <div className="modes">
          <button
            className={
              mode === 'search'
                ? 'active'
                : ''
            }
            onClick={() =>
              setMode(
                'search',
              )
            }
          >
            ⌕ Meklēšana
          </button>

          <button
            className={
              mode ===
              'assistant'
                ? 'active'
                : ''
            }
            onClick={() =>
              setMode(
                'assistant',
              )
            }
          >
            ✦ CENIQ AI
          </button>
        </div>

        <form
          className="bigsearch"
          onSubmit={(
            e: FormEvent<HTMLFormElement>,
          ) =>
            submit(e)
          }
        >
          <span>⌕</span>

          <input
            value={query}
            onChange={(
              e: ChangeEvent<HTMLInputElement>,
            ) =>
              setQuery(
                e.target.value,
              )
            }
            placeholder={
              mode === 'search'
                ? 'Piem., iPhone 16 128GB'
                : 'Piem., portatīvais dators līdz 1200 € spēlēm'
            }
          />

          <button
            disabled={
              loading
            }
          >
            {loading
              ? 'Meklē…'
              : mode ===
                  'assistant'
                ? 'Jautāt'
                : 'Meklēt'}
          </button>
        </form>

        {status && (
          <div className="searchstatus">
            <i />
            {status}
          </div>
        )}

        {error && (
          <div className="errorbox">
            {error}
          </div>
        )}

        {notice &&
          !error && (
            <div className="searchnotice">
              {notice}
            </div>
          )}
      </section>

      {plan && (
        <section className="container aianswer">
          <div className="aibadge">
            ✦ CENIQ
          </div>

          <h2>
            {plan.summary}
          </h2>

          {!!plan.constraints
            ?.length && (
            <div className="chips">
              {plan.constraints.map(
                (
                  constraint: string,
                ) => (
                  <span
                    key={
                      constraint
                    }
                  >
                    {
                      constraint
                    }
                  </span>
                ),
              )}
            </div>
          )}
        </section>
      )}

      {results.length >
        0 && (
        <section
          className="container results results-v32"
          id="results"
        >
          <div className="sectiontitle resulttitle-v32">
            <div>
              <span>
                ATRASTIE
                PRODUKTI
              </span>

              <h2>
                Cenas un
                varianti
              </h2>
            </div>

            <div className="resultsource">
              {sourceLabel && (
                <small>
                  {
                    sourceLabel
                  }
                </small>
              )}

              <b>
                {
                  results.length
                }{' '}
                {results.length ===
                1
                  ? 'produktu grupa'
                  : 'produktu grupas'}
              </b>
            </div>
          </div>

          {results.length >
            1 && (
            <div className="results-sortbar">
              <span>
                Kārtot
              </span>

              <button
                className={
                  sortMode ===
                  'coverage'
                    ? 'active'
                    : ''
                }
                onClick={() =>
                  setSortMode(
                    'coverage',
                  )
                }
              >
                Vairāk veikalu
              </button>

              <button
                className={
                  sortMode ===
                  'price'
                    ? 'active'
                    : ''
                }
                onClick={() =>
                  setSortMode(
                    'price',
                  )
                }
              >
                Lētākā cena
              </button>

              <button
                className={
                  sortMode ===
                  'score'
                    ? 'active'
                    : ''
                }
                onClick={() =>
                  setSortMode(
                    'score',
                  )
                }
              >
                CENIQ score
              </button>
            </div>
          )}

          <div className="resultfamily-list">
            {sortedResults.map(
              (product: ProductResult) => (
                <ProductCard
                  product={
                    product
                  }
                  query={
                    query
                  }
                  key={
                    product.id
                  }
                />
              ),
            )}
          </div>
        </section>
      )}

      <section
        className="container section"
        id="populari"
      >
        <div className="sectiontitle">
          <div>
            <span>
              ŠOBRĪD MEKLĒ
            </span>

            <h2>
              Populārākie
            </h2>
          </div>
        </div>

        <div className="popularRow">
          {popular.map(
            (
              item: string,
              index: number,
            ) => (
              <button
                key={item}
                onClick={() =>
                  submit(
                    undefined,
                    item,
                    'search',
                  )
                }
              >
                <b>
                  {String(
                    index + 1,
                  ).padStart(
                    2,
                    '0',
                  )}
                </b>

                <span>
                  {item}
                </span>

                <i>↗</i>
              </button>
            ),
          )}
        </div>
      </section>

      <section className="container section">
        <div className="sectiontitle">
          <div>
            <span>
              ĀTRĀ PIEKĻUVE
            </span>

            <h2>
              Kategorijas
            </h2>
          </div>
        </div>

        <div className="categorygrid">
          {categories.map(
            ([
              icon,
              label,
              searchQuery,
            ]) => (
              <button
                key={
                  label
                }
                onClick={() =>
                  submit(
                    undefined,
                    searchQuery,
                    'search',
                  )
                }
              >
                <span>
                  {icon}
                </span>

                <b>
                  {label}
                </b>

                <i>→</i>
              </button>
            ),
          )}
        </div>
      </section>
    </>
  );
}
