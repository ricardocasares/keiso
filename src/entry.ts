import { Runtime } from 'foldkit'

import { Message, Model, flags, init, update, view } from './main'
import { Flags } from './model'
import { subscriptions } from './subscription'

const application = Runtime.makeApplication({
  Model,
  Flags,
  init,
  update,
  view,
  subscriptions,
  container: document.getElementById('root'),
  devTools: { Message },
})

Runtime.run(application, { flags })
