// tests/mutation-control.test.mjs — the negative control, checked without Docker.
//
// The control's own claim is "a scenario that stays green while the API lies is green about nothing".
// That claim is only as good as the proxy: if the mutation never reaches the wire, every scenario
// stays green and the control reports the suite as broken when the fault is its own. So the proxy is
// exercised here against a real upstream on localhost — no Docker, no PetClinic, no dotnet.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import {
  MUTATIONS,
  PASSTHROUGH,
  applyMutation,
  parseFailures,
  gradeMutation,
  startProxy,
} from '../scripts/mutation-control.mjs';

/** A stand-in for PetClinic: answers whatever the test tells it to. */
function upstream(handler) {
  const server = createServer((req, res) => handler(req, res));
  return new Promise((ready) => server.listen(0, () => ready(server)));
}

const portOf = (server) => server.address().port;

async function through(mutation, { path, status = 200, body, method = 'GET' }) {
  const origin = await upstream((req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  const proxy = await startProxy({
    mutation,
    port: 0,
    target: `http://localhost:${portOf(origin)}/petclinic/api`,
  });

  try {
    const response = await fetch(`http://localhost:${portOf(proxy)}${path}`, { method });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } finally {
    proxy.close();
    origin.close();
  }
}

test('every mutation names at least one AC that must fail', () => {
  // A mutation with no expectation cannot fail the control, so it would be a run that costs minutes
  // and proves nothing.
  for (const [name, mutation] of Object.entries(MUTATIONS)) {
    assert.ok(mutation.expect.length > 0, `${name} expects nothing`);
    for (const ac of mutation.expect) assert.match(ac, /^AC-F\d{2}-\d{2}$/, `${name}: ${ac}`);
  }
});

test('no mutation touches anything but GET', () => {
  // Teardown deletes what the scenarios create. A mutation reaching DELETE would leave records in a
  // database the NEXT run is graded against, and that failure would surface as an unrelated scenario
  // going red hours later.
  for (const [name, mutation] of Object.entries(MUTATIONS)) {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      assert.equal(
        mutation.applies({ method, pathname: '/petclinic/api/owners/1', status: 200 }),
        false,
        `${name} applies to ${method}`
      );
    }
  }
});

test('drop-pet-name removes the field on the pet route and leaves the owner route alone', () => {
  const mutation = MUTATIONS['drop-pet-name'];
  const pet = { id: 7, name: 'Rex', birthDate: '2020-05-14' };

  const onPet = applyMutation(mutation, { method: 'GET', pathname: '/petclinic/api/pets/7', status: 200, body: pet });
  assert.deepEqual(onPet.body, { id: 7, birthDate: '2020-05-14' });

  const onOwner = applyMutation(mutation, {
    method: 'GET',
    pathname: '/petclinic/api/owners/7',
    status: 200,
    body: pet,
  });
  assert.deepEqual(onOwner.body, pet, 'an unrelated route must pass through untouched');
});

test('found-instead-of-missing turns a 404 into a 200 and nothing else', () => {
  const mutation = MUTATIONS['found-instead-of-missing'];
  const missing = applyMutation(mutation, { method: 'GET', pathname: '/petclinic/api/pets/9', status: 404, body: null });
  assert.equal(missing.status, 200);

  const present = applyMutation(mutation, {
    method: 'GET',
    pathname: '/petclinic/api/pets/9',
    status: 200,
    body: { id: 9 },
  });
  assert.equal(present.status, 200);
  assert.deepEqual(present.body, { id: 9 });
});

test('the proxy actually applies the mutation on the wire', async () => {
  const result = await through(MUTATIONS['drop-pet-name'], {
    path: '/petclinic/api/pets/7',
    body: { id: 7, name: 'Rex', birthDate: '2020-05-14' },
  });

  assert.equal(result.status, 200);
  assert.ok(!('name' in result.body), 'the proxy forwarded the untouched body');
  assert.equal(result.body.id, 7, 'the rest of the body must survive');
});

test('the proxy forwards an unmutated route byte for byte', async () => {
  const body = { id: 3, firstName: 'Anna', pets: [{ id: 9, name: 'Rex' }] };
  const result = await through(MUTATIONS['drop-pet-name'], { path: '/petclinic/api/owners/3', body });
  assert.deepEqual(result.body, body);
});

test('the proxy turns a 404 into a 200 when that is the mutation', async () => {
  const result = await through(MUTATIONS['found-instead-of-missing'], {
    path: '/petclinic/api/pets/404',
    status: 404,
    body: null,
  });
  assert.equal(result.status, 200);
});

test('the proxy rewrites content-length, so the client is not left waiting', async () => {
  // A body that shrinks under a stale `content-length` hangs the reader until its timeout, and the
  // suite then fails for a reason that has nothing to do with the mutation.
  const result = await through(MUTATIONS['empty-owner-pets'], {
    path: '/petclinic/api/owners/3',
    body: { id: 3, pets: [{ id: 9, name: 'Rex' }, { id: 10, name: 'Max' }] },
  });
  assert.deepEqual(result.body.pets, []);
});

test('a busy port is a sentence, not an unhandled crash', async () => {
  // An `'error'` event with no listener is a hard crash. A leftover `control serve` from an earlier
  // session is the ordinary way to occupy the port, and before this the script died with a raw stack
  // while the promise never settled — no message, no diagnosis, and nothing naming the fix.
  const squatter = await upstream((req, res) => res.end());
  const port = portOf(squatter);

  try {
    await assert.rejects(
      () => startProxy({ mutation: PASSTHROUGH, port, target: 'http://localhost:1/petclinic/api' }),
      /already in use.*control serve/s
    );
  } finally {
    squatter.close();
  }
});

test('parseFailures reads both the summary count and the AC ids', () => {
  const output = [
    '  Failed AC_F02_01_an_added_pet_is_visible_in_the_owner_details [1 s]',
    '  Failed AC_F02_03_a_rename_in_the_pet_details_is_visible [900 ms]',
    '  Passed AC_F01_01_a_registered_owner_is_visible [700 ms]',
    'Failed!  - Failed:     2, Passed:    21, Skipped:     0, Total:    23',
  ].join('\n');

  const parsed = parseFailures(output);
  assert.equal(parsed.failed, 2);
  assert.deepEqual([...parsed.acIds].sort(), ['AC-F02-01', 'AC-F02-03']);
});

test('parseFailures reads the newer `X name` failure format too', () => {
  const parsed = parseFailures('  X AC_F01_03_opening_a_deleted_owner_gives_404 [1 s]\nFailed:     1, Passed: 22');
  assert.deepEqual([...parsed.acIds], ['AC-F01-03']);
});

test('parseFailures does not read a PASSING test as a failure', () => {
  // The one direction that would make the control lie green: a passed line misread as failed means
  // every mutation looks caught.
  const parsed = parseFailures('  Passed AC_F02_01_an_added_pet [1 s]\nPassed!  - Failed:     0, Passed:    23');
  assert.equal(parsed.acIds.size, 0);
  assert.equal(parsed.failed, 0);
});

test('a mutation nobody noticed is a MISS, and the AC that stayed green is named', () => {
  const grade = gradeMutation(MUTATIONS['drop-pet-name'], parseFailures('Passed!  - Failed:     0, Passed:    23'));
  assert.equal(grade.ok, false);
  assert.deepEqual(grade.missing, ['AC-F02-01']);
});

test('extra failures beyond the expected set are reported, not treated as a fault', () => {
  // The blast radius of a mutation is wider than the ACs whose text names it, and it grows every time
  // a scenario is added. A control that demanded the exact set would go red for the wrong reason.
  const grade = gradeMutation(
    MUTATIONS['drop-pet-name'],
    parseFailures('  Failed AC_F02_01_x\n  Failed AC_F02_05_y\nFailed:     2, Passed: 21')
  );
  assert.equal(grade.ok, true);
  assert.deepEqual(grade.observed, ['AC-F02-01', 'AC-F02-05']);
});

test('a mutation that fails the WHOLE suite is not a catch', () => {
  // The bug the first real run of the control exposed, and the reason this clause exists. All four
  // mutations reported every acceptance criterion red, identically, and the control called all four
  // caught: `expect ⊆ observed` is satisfied trivially when `observed` is everything. The cause was
  // `runSuite` being synchronous while the proxy shares its process — the event loop was blocked for
  // the whole suite, so nothing was served and every scenario timed out in the readiness probe.
  const everything = parseFailures(
    '  Failed AC_F01_01_x\n  Failed AC_F02_01_y\nFailed!  - Failed:    23, Passed:     0, Total:    23'
  );
  const grade = gradeMutation(MUTATIONS['drop-pet-name'], everything);

  assert.equal(grade.indiscriminate, true);
  assert.equal(grade.ok, false, 'a suite that is entirely red proves nothing about any one criterion');
});

test('a proportionate blast radius IS a catch', () => {
  // Measured through the real proxy on 2026-08-19: `drop-pet-name` failed 7 of 23 — F02-01/03/04/05/06,
  // F03-05 and the smoke chain — while every F01 scenario stayed green. That is what a real catch
  // looks like, and it must not be confused with the case above.
  const measured = parseFailures(
    [
      '  Failed AC_F02_01AnAddedPetIsVisible [435 ms]',
      '  Failed AC_F02_03ARenameInThePetDetails [291 ms]',
      '  Failed AC_F02_04ARenameThroughTheOwnerDetails [196 ms]',
      '  Failed AC_F02_05EditingAPetsData [209 ms]',
      '  Failed AC_F02_06DeletingOnePet [204 ms]',
      '  Failed AC_F03_05ACancelledVisit [212 ms]',
      '  Failed Smoke_full_chain_through_services [215 ms]',
      'Failed!  - Failed:     7, Passed:    16, Skipped:     0, Total:    23',
    ].join('\n')
  );

  assert.equal(measured.failed, 7);
  assert.equal(measured.total, 23);
  const grade = gradeMutation(MUTATIONS['drop-pet-name'], measured);
  assert.equal(grade.ok, true);
  assert.equal(grade.indiscriminate, false);
  assert.ok(!grade.observed.includes('AC-F01-01'), 'an unaffected criterion must not appear as failed');
});

test('the passthrough mutation changes nothing at all', async () => {
  // It is the proxy's own baseline: if the suite is not green THROUGH an unmutated proxy, every
  // mutation below it would "pass" for that reason alone.
  const body = { id: 3, firstName: 'Anna', pets: [{ id: 9, name: 'Rex' }] };
  for (const path of ['/petclinic/api/owners/3', '/petclinic/api/pets/9', '/petclinic/api/pettypes']) {
    const result = await through(PASSTHROUGH, { path, body });
    assert.deepEqual(result.body, body, `${path} was altered by the passthrough`);
    assert.equal(result.status, 200);
  }
  for (const status of [200, 201, 404]) {
    const result = await through(PASSTHROUGH, { path: '/petclinic/api/pets/1', status, body: null });
    assert.equal(result.status, status, 'the passthrough must not touch the status either');
  }
});

test('failures whose names could not be read are their own outcome, not a miss', () => {
  // A change of test-name convention reduces the parsed set to nothing, which reads exactly like a
  // mutation that broke nothing. Reporting it as a red control would send someone to debug the tests.
  const grade = gradeMutation(MUTATIONS['drop-pet-name'], parseFailures('  Failed SomeOtherTest\nFailed:     4, Passed: 19'));
  assert.equal(grade.unattributed, true);
  assert.equal(grade.ok, false);
});
