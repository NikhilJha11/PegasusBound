import authentication from './authentication';
import { includeBearerToken, handleApiErrors } from './lib/client';
import { dropdownTriggers } from './lib/dropdowns';
import type { ResourceModule } from './lib/types';

import * as contacts from './resources/contacts';
import * as deals from './resources/deals';
import * as tasks from './resources/tasks';
import * as campaigns from './resources/campaigns';
import * as mailboxes from './resources/mailboxes';
import * as inbox from './resources/inbox';
import * as meetings from './resources/meetings';
import * as templates from './resources/templates';
import * as groups from './resources/groups';
import * as analytics from './resources/analytics';

// version + platformVersion are required by Zapier; read from package.json and
// the installed core. require avoids pulling package.json into the TS rootDir.
const packageJson = require('../package.json');
const corePackageJson = require('zapier-platform-core');

// Every feature lives in one resource module exporting triggers/creates/searches.
// Add a feature by editing the matching resources/<name>.ts file.
const resources: ResourceModule[] = [
  contacts,
  deals,
  tasks,
  campaigns,
  mailboxes,
  inbox,
  meetings,
  templates,
  groups,
  analytics,
];

const collect = (pick: (r: ResourceModule) => Array<{ key: string }> | undefined) =>
  resources.flatMap((r) => pick(r) ?? []);

const byKey = (items: Array<{ key: string }>): Record<string, any> =>
  items.reduce((acc: Record<string, any>, item) => {
    acc[item.key] = item;
    return acc;
  }, {});

export default {
  version: packageJson.version,
  platformVersion: corePackageJson.version,
  authentication,
  beforeRequest: [includeBearerToken],
  afterResponse: [handleApiErrors],
  // Hidden dropdown list-triggers come first, then each resource's triggers.
  triggers: byKey([...dropdownTriggers, ...collect((r) => r.triggers)]),
  creates: byKey(collect((r) => r.creates)),
  searches: byKey(collect((r) => r.searches)),
};
