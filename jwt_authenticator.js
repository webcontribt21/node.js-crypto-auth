import config from 'config';
import { Members } from './src/models';
import { TokenAuthenticator } from './src/lib/auth/TokenAuthenticator';

const forceArray = x => Array.isArray(x) ? x : [x];

const isValidEmail = email => true;


export class JWTAuthenticator {
  constructor(token) {
    this.token = token;
  }

  /**
   * Decodes and verifies JWT.
   * Returns authentic member by email or raises an exception.
   * @param options {{return}}
   * @returns {Promise<Members>}
   */
  async authenticate_forced(options = {}) {
    try {
      const authenticator = new TokenAuthenticator(config.jwt);
      const { payload, header } = authenticator.authenticate(this.token);

      const member = await this.fetch_member(payload);
      if (options.return === 'member') {
        return member;
      } else {
        return await this.fetch_email(payload);
      }
    } catch (err) {
      logger.error(err);
      throw err;
    }
  }

  /**
   * Exception-safe version of #authenticate_forced.
   * @param args
   * @returns {Promise<*>}
   */
  async authenticate(args) {
    try {
      return this.authenticate_forced(args);
    } catch {
      return null;
    }
  }

  // private
  async fetch_email(payload) {
    const email = payload.email;
    if (!email) {
      throw new AuthError('E-Mail is blank.');
    }
    if (!isValidEmail(email)) {
      throw new AuthError('E-Mail is invalid.');
    }
    return email;
  }

  fetch_uid(payload) {
    const uid = payload.uid;
    if (!uid) {
      throw new AuthError('UID is blank.');
    }
    return uid;
  }

  fetch_scopes(payload) {
    const scopes = forceArray(payload.scale)
      .filter(scope => !!scope);
    if (!scopes.length) {
      throw new AuthError('Token scopes are not defined.');
    }

    return scopes;
  }

  async fetch_member(payload) {
    if (payload.iss === 'barong') {
      try {
        return await this.from_barong_payload(payload);
        // # Handle race conditions when creating member & authentication records.
        // # We do not handle race condition for update operations.
        // # http://api.rubyonrails.org/classes/ActiveRecord/Relation.html#method-i-find_or_create_by
      } catch (err) {
        return await this.fetch_member(payload);
      // TODO - retry
      }
    } else {
      const query = {
        where: { email: this.fetch_email(payload) },
      };
      return await Members.findOne(query);
    }
  }

  async from_barong_payload(payload) {
    const email = this.fetch_email(payload);

    const [member, isCreated] = await Members.findOrBuild({ where: { email } });

    await member.within_transaction(async transaction => {
      const attributes = {
        level: Number(payload.level),
        disabled: payload.state !== 'active',
      };
      // # Prevent overheat validations.
      member.set(attributes);
      await member.save({ transaction });
      // member.save!(validate: member.new_record?)

      // # Prevent overheat validations.
      const authentications = await member.getAuthentications({
        where: {
          provider: 'barong',
          uid: this.fetch_uid(payload),
        },
        transaction,
      });
      if (!authentications.length) {
        await member.createAuthentication({
          provider: 'barong',
          uid: this.fetch_uid(payload),
        }, { transaction });
      }
    });
  }
}
