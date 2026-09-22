#include "InputManager.h"
#include <GLFW/glfw3.h>


InputManager::InputManager(Window& refWindow) : m_refWindow(refWindow)
{
}

void InputManager::CallbackMouseClick(int key, int inputType, double dx, double dy)
{
	m_dx = dx;
	m_dy = dy;

	if (key == GLFW_MOUSE_BUTTON_RIGHT)
	{
		TriggerCallback(RIGHT_CLICK, inputType);
	}

	if (key == GLFW_MOUSE_BUTTON_LEFT)
	{
		TriggerCallback(LEFT_CLICK, inputType);
	}
}

void InputManager::CallbackMouseScroll(double yScroll)
{
	m_scrollY = yScroll;

	TriggerCallback(SCROLL, HOLD);
}

void InputManager::CallbackKeyPress(int key, int inputType)
{
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

void InputManager::TriggerCallback(KEY_ACTIONS action, int inputType)
{
	INPUT_TYPE type;
	switch (inputType)
	{
	case GLFW_PRESS:
		type = PRESS;
		break;
	case GLFW_REPEAT:
		type = HOLD;
		break;
	case GLFW_RELEASE:
		type = RELEASE;
		break;
	default:
		type = PRESS;
		break;
	}

	//Loop through all calbacks stored
	for (std::function<void(InputManager&, INPUT_TYPE inputType)> func : m_inputCallback[m_inputState][action])
	{
		func(*this, type);
	}


}
