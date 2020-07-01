import {Publisher} from "@bct/simple-amqp-client";

interface IPublishChannel {
  key: string,
  value: Publisher<any>,
}

class PublishChannel {
  private _publisherChannels: IPublishChannel[];

  constructor() {
    this._publisherChannels = [];
  }

  getPublishChannel(key: string) {
    const publish = this._publisherChannels.find(d => d.key === key);
    if (!publish) {
      return null;
    }

    return publish.value;
  }

  setPublishChannel(key: string, value: Publisher<any>) {
    this._publisherChannels.push({
      key,
      value,
    });
  }
}

const instance = new PublishChannel();
Object.freeze(instance);

export default instance;
