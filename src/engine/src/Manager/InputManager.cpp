#include "InputManager.h"
#include <QtCore/qnamespace.h>


void InputManager::CallbackMouseClick(int button, INPUT_TYPE inputType, double dx, double dy)
{
	m_dx = dx;
	m_dy = dy;

	if (button == Qt::RightButton)
	{
		TriggerCallback(RIGHT_CLICK, inputType);
	}

	if (button == Qt::LeftButton)
	{
		TriggerCallback(LEFT_CLICK, inputType);
	}
}

void InputManager::CallbackMouseScroll(double yScroll)
{
	m_scrollY = yScroll;

	TriggerCallback(SCROLL, HOLD);
}

void InputManager::CallbackKeyPress(int key, INPUT_TYPE inputType)
{

	KEY_ACTIONS input = ALL_ACTIONS;

	switch (key)
	{
	case Qt::Key_W:
	case Qt::Key_Up:
		TriggerCallback(FORWARD, inputType);
		break;

	case Qt::Key_S:
	case Qt::Key_Down:
		TriggerCallback(BACKSWARD, inputType);
		break;

	case Qt::Key_A:
	case Qt::Key_Left:
		TriggerCallback(LEFT, inputType);
		break;

	case Qt::Key_D:
	case Qt::Key_Right:
		TriggerCallback(RIGHT, inputType);
		break;

	}

}

void InputManager::AddCallBack(STATE stateTrigger, KEY_ACTIONS action, std::function<void(InputManager&, INPUT_TYPE)> callback)
{
	if (stateTrigger == ALL_STATES)
	{
		for (int stateTrig = NONE; stateTrig < ALL_STATES; stateTrig++)
		{
			m_inputCallback[stateTrig][action].push_back(callback);
		}
	}
	else
	{
		m_inputCallback[stateTrigger][action].push_back(callback);
		return;
	}

}

void InputManager::TriggerCallback(KEY_ACTIONS action, INPUT_TYPE inputType)
{
	//Loop through all calbacks stored
	for (std::function<void(InputManager&, INPUT_TYPE inputType)> func : m_inputCallback[m_inputState][action])
	{
		func(*this, inputType);
	}


}
