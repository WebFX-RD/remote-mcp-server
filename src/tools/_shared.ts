import traverse from 'traverse';

type SiteIdType = { type: 'numeric'; value: number } | { type: 'alphanumeric'; value: string };

export function classifySiteId(id: number | string): SiteIdType {
  if (!['number', 'string'].includes(typeof id)) {
    throw new Error(`Expected id to be number | string, received ${id}`);
  }
  if (typeof id === 'number') {
    return { type: 'numeric', value: id };
  } else if (/^\d+$/.test(id)) {
    return { type: 'numeric', value: Number(id) };
  } else {
    return { type: 'alphanumeric', value: id };
  }
}

export function parseQueryForSiteId(query: Record<string, any>) {
  let siteIdClassification: ReturnType<typeof classifySiteId> | undefined;
  traverse(query).forEach(function (x) {
    if (siteIdClassification !== undefined) {
      return;
    }
    if (this.key === 'siteId') {
      siteIdClassification = classifySiteId(x);
    }
  });
  return siteIdClassification;
}
